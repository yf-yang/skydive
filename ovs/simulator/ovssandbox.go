package simulator

import (
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"strconv"
	"time"

	"strings"

	"github.com/skydive-project/skydive/common"
	"github.com/skydive-project/skydive/config"
	"github.com/skydive-project/skydive/logging"
	"github.com/skydive-project/skydive/topology/graph"
	"golang.org/x/net/context"
)

const (
	keyOfPort    = "OfPort"
	keyType      = "Type"
	keyTid       = "TID"
	typHost      = "host"
	typOfrule    = "ofrule"
	typOvsbridge = "ovsbridge"
	typOvsport   = "ovsport"
	typPatch     = "patch"
)

// Sandbox represents an individual sandbox associated to a given time
type Sandbox struct {
	// Simulator is a BackPointer to simulator
	Simulator *Simulator
	// Time defining the sandbox
	Time int64
	// Naming associates simulator names back to graph nodes.
	Naming map[string]*graph.Node
	// Back Naming translates Id back to Sandbox names.
	BackNaming map[graph.Identifier]string
	// Graph is a Contexturalized graph relative to time.
	Graph *graph.Graph
}

// SandboxListener declares an interface that should be implemented to listen to node evolution in a simulator
type SandboxListener interface {
	OnSandboxAdded(date int64)
	OnSandboxDeleted(date int64)
	OnSandboxNodesAdded(date int64, nodes []graph.Identifier)
	OnSandboxNodesDeleted(date int64, nodes []graph.Identifier)
}

// Simulator is the internal representation of the Openvswitch simulator. It maintains the lists of activated
// bridges, ports and rules.
type Simulator struct {
	// DataFolder is where the simulator stores its data
	DataFolder string
	// Graph is the graph used by the simulator
	Graph *graph.Graph
	// Sandbox is the map of sandbox with time as key
	Sandboxes map[int64]*Sandbox
	Listeners []SandboxListener
	count     int
	// Path to ovsdb-server daemon
	ovsdbServer string
	// Path to ovsdb-tool command
	ovsdbTool string
	// Path to ovs-vswitchd daemon
	ovsVswitchd string
	// Path to the ovs-schema
	ovsSchema string
	// Path to ovs-appctl command
	ovsAppCtl string
	// Path to ovs-ofctl command
	ovsOfCtl string
	// Path to ovs-vsctl command
	ovsVsCtl string
}

// Execute is an interface describing a method to execute shell commands and a way to cancel it.
type Execute interface {
	ExecCommand(string, ...string) ([]byte, error)
	Cancel()
}

// RealExecute is an implementation of Execute performing the command
type RealExecute struct {
	ctx    context.Context
	cancel context.CancelFunc
}

// NewExecute creates an execution engine
func NewExecute() *RealExecute {
	ctx, cancel := context.WithCancel(context.Background())
	return &RealExecute{
		ctx:    ctx,
		cancel: cancel,
	}
}

var execute Execute = NewExecute()

// ExecCommand launchs a command under the control of a global cancel context and a local timeout of 30s
func (re *RealExecute) ExecCommand(cmd string, args ...string) ([]byte, error) {
	ctx, _ := context.WithTimeout(re.ctx, time.Second*30)
	/* #nosec */
	command := exec.Command(cmd, args...)
	waitDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if command.Process == nil {
				return
			}
			erk := command.Process.Kill()
			if erk != nil {
				logging.GetLogger().Errorf("Cannot kill background process: %s", cmd)
			}
		case <-waitDone:
		}
	}()
	output, exit := command.CombinedOutput()
	close(waitDone)
	re.cancel()
	logging.GetLogger().Infof("SANDBOX>> %s %v", cmd, args)
	logging.GetLogger().Infof("SANDBOX<< %s", output)

	return output, exit
}

// Cancel is the global cancel context that will stop long running processes that are still attached.
func (re *RealExecute) Cancel() {
	re.cancel()
}

func setEnvironment(dataFolder string) error {
	err := os.Setenv("OVS_RUNDIR", dataFolder)
	if err != nil {
		return err
	}
	err = os.Setenv("OVS_DBDIR", dataFolder)
	if err != nil {
		return err
	}
	err = os.Setenv("OVS_LOGDIR", dataFolder)
	if err != nil {
		return err
	}
	err = os.Setenv("OVS_SYSCONFIGDIR", dataFolder)
	return err
}

func (simulator *Simulator) kill(command string) error {
	pidfile := simulator.DataFolder + "/" + command + ".pid"
	content, err := ioutil.ReadFile(pidfile)
	if err != nil {
		return err
	}
	pid, err2 := strconv.Atoi(string(content))
	if err2 != nil {
		return err2
	}
	process, err3 := os.FindProcess(pid)
	if err3 != nil {
		return err3
	}
	return process.Kill()
}

func (sandbox *Sandbox) removeNode(node *graph.Node) (string, bool) {
	ID, ok := sandbox.BackNaming[node.ID]
	if !ok {
		return "", false
	}
	delete(sandbox.BackNaming, node.ID)
	delete(sandbox.Naming, ID)
	return ID, true
}

func (sandbox *Sandbox) getSandboxID(node *graph.Node) (string, graph.Identifier, bool) {
	ID, ok1 := sandbox.BackNaming[node.ID]
	return ID, node.ID, ok1
}

func (sandbox *Sandbox) name(prefix string, node *graph.Node) (string, error) {
	name, ok := sandbox.BackNaming[node.ID]
	if ok {
		return name, nil
	}
	simulator := sandbox.Simulator
	name = fmt.Sprintf("%s%d", prefix, simulator.count)
	simulator.count = simulator.count + 1
	sandbox.Naming[name] = node
	sandbox.BackNaming[node.ID] = name
	return name, nil
}

func (sandbox *Sandbox) bridgeName(node *graph.Node) (string, error) {
	return sandbox.name("B", node)
}

func (sandbox *Sandbox) portName(node *graph.Node) (string, error) {
	return sandbox.name("P", node)
}

func (sandbox *Sandbox) interfaceName(node *graph.Node) (string, error) {
	return sandbox.name("I", node)
}

// CreateBridge creates a new bridge in the simulator from the info given by the graph node.
func (sandbox *Sandbox) CreateBridge(bridge *graph.Node) (string, error) {
	sandbox.Simulator.Graph.RLock()
	defer sandbox.Simulator.Graph.RUnlock()
	br, err := sandbox.bridgeName(bridge)
	if err != nil {
		return "", err
	}
	_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "add-br", br, "--", "set", "Bridge", br, "fail-mode=secure")
	return br, err
}

// DeleteBridge deletes a bridge in the simulator with all its ports.
func (sandbox *Sandbox) DeleteBridge(bridge *graph.Node) (string, error) {
	sandbox.Simulator.Graph.RLock()
	defer sandbox.Simulator.Graph.RUnlock()
	br, tid, ok := sandbox.getSandboxID(bridge)
	if !ok {
		return "", fmt.Errorf("unknown bridge %s cannot be deleted", bridge.ID)
	}
	_, err := execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "del-br", br)
	delete(sandbox.BackNaming, tid)
	delete(sandbox.Naming, br)
	return br, err
}

func findPatchChain(g *graph.Graph, node *graph.Node) (*graph.Node, *graph.Node, *graph.Node, error) {
	var port *graph.Node
	var nodes []*graph.Node
	patch := g.LookupFirstChild(node, graph.Metadata{keyType: typPatch})
	if patch == nil {
		nodes = g.LookupParents(node, graph.Metadata{keyType: typPatch}, nil)
		if len(nodes) == 1 {
			patch = nodes[0]
		} else {
			return nil, nil, nil, errors.New("No patch port")
		}
	}
	nodes = g.LookupParents(patch, graph.Metadata{keyType: typOvsport}, nil)
	dedup(&nodes)
	if len(nodes) == 1 {
		port = nodes[0]
	} else {
		return nil, nil, nil, errors.New("No port")
	}
	nodes = g.LookupParents(port, graph.Metadata{keyType: typOvsbridge}, nil)
	dedup(&nodes)
	if len(nodes) != 1 {
		return nil, nil, nil, errors.New("No bridge")
	}
	return patch, port, nodes[0], nil
}

func (sandbox *Sandbox) linkPatch(itf *graph.Node, p string) error {
	_, err := execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "set", "interface", p, "type=patch")
	if err != nil {
		return err
	}
	_, pPort, _, err := findPatchChain(sandbox.Graph, itf)
	if err != nil {
		return err
	}
	pp, _, ok := sandbox.getSandboxID(pPort)
	if !ok {
		return nil
	}
	_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "set", "interface", p,
		fmt.Sprintf("option:peer=%s", pp))
	if err != nil {
		return err
	}
	_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "set", "interface", pp,
		fmt.Sprintf("option:peer=%s", p))
	return err
}

func (sandbox *Sandbox) computeInterfaceArgs(interfaces []*graph.Node) ([]graph.Identifier, []string, []int64, error) {
	l := len(interfaces)
	ids := make([]graph.Identifier, l)
	itfs := make([]string, l)
	ofports := make([]int64, l)
	for i := range interfaces {
		interf := interfaces[i]
		itf, err := sandbox.interfaceName(interf)
		if err != nil {
			return nil, nil, nil, err
		}
		itfs[i] = itf
		metadata := interf.Metadata()
		ids[i] = interf.ID
		ofports[i] = metadata[keyOfPort].(int64)
	}
	return ids, itfs, ofports, nil
}

func (sandbox *Sandbox) createSimplePort(bridge *graph.Node, port *graph.Node, itf *graph.Node) ([]graph.Identifier, error) {
	var ids []graph.Identifier
	br, err := sandbox.bridgeName(bridge)
	if err != nil {
		return nil, err
	}
	metadata := itf.Metadata()
	ofport := metadata[keyOfPort].(int64)
	if ofport == 65534 {
		// This is the local port (-2)
		return nil, nil
	}
	p, err1 := sandbox.portName(port)
	if err1 != nil {
		return nil, err1
	}
	_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "add-port", br, p,
		"--", "set", "interface", p, fmt.Sprintf("ofport_request=%d", ofport))
	if err != nil {
		return nil, err
	}
	ids = append(ids, port.ID)
	if metadata[keyType] == typPatch {
		err = sandbox.linkPatch(itf, p)
	}
	return ids, err
}

func (sandbox *Sandbox) createBondPort(bridge *graph.Node, port *graph.Node, interfaces []*graph.Node) ([]graph.Identifier, error) {
	var ids []graph.Identifier
	br, err := sandbox.bridgeName(bridge)
	if err != nil {
		return nil, err
	}
	p, err := sandbox.portName(port)
	if err != nil {
		return nil, err
	}
	ids = append(ids, port.ID)
	idsItf, itfs, ofports, err := sandbox.computeInterfaceArgs(interfaces)
	if err != nil {
		return nil, err
	}
	ids = append(ids, idsItf...)
	_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, append([]string{"add-bond", br, p}, itfs...)...)
	if err != nil {
		return nil, err
	}
	for i := range interfaces {
		_, err = execute.ExecCommand(sandbox.Simulator.ovsVsCtl, "set", "interface", itfs[i], fmt.Sprintf("ofport_request=%d", ofports[i]))
		if err != nil {
			break
		}
	}
	return ids, err
}

// CreatePort creates a port attached to a bridge of the simulator from the info from the graph nodes.
func (sandbox *Sandbox) CreatePort(bridge *graph.Node, port *graph.Node, interfaces []*graph.Node) ([]graph.Identifier, error) {
	sandbox.Simulator.Graph.RLock()
	defer sandbox.Simulator.Graph.RUnlock()
	switch len(interfaces) {
	case 0:
		return nil, fmt.Errorf("no interface for port %s", port.ID)
	case 1:
		itf := interfaces[0]
		return sandbox.createSimplePort(bridge, port, itf)
	default:
		return sandbox.createBondPort(bridge, port, interfaces)
	}
}

// DeletePort deletes a port in the simulator
func (simulator *Simulator) DeletePort(bridge *graph.Node, port *graph.Node) error {
	return nil
}

func stringOfRule(rule *graph.Node) string {
	metadata := rule.Metadata()
	cookie := metadata["cookie"].(string)
	table := metadata["table"].(int64)
	filter := metadata["filters"].(string)
	actions := metadata["actions"].(string)
	raw := fmt.Sprintf("cookie=%s,table=%d,%s,actions=%s", cookie, table, filter, actions)
	return strings.Replace(raw, ";", ",", -1)
}

// CreateRule creates a new openflow rule on a simulator bridge from infos from the graph nodes
func (sandbox *Sandbox) CreateRule(bridge *graph.Node, rule *graph.Node) error {
	sandbox.Simulator.Graph.RLock()
	defer sandbox.Simulator.Graph.RUnlock()
	br, _, ok := sandbox.getSandboxID(bridge)
	if !ok {
		return errors.New("Undeclared bridge")
	}
	r := stringOfRule(rule)
	_, err := execute.ExecCommand(sandbox.Simulator.ovsOfCtl, "add-flow", br, r)
	return err
}

// DeleteRule deletes a rule in the simulator
func (simulator *Simulator) DeleteRule(bridge *graph.Node, rule *graph.Node) error {
	return nil
}

// ovsdb/ovsdb-tool create simulator/conf.db ../vswitchd/vswitch.ovsschema
// ovsdb-server --detach --no-chdir --pidfile -vconsole:off --log-file --remote=punix:.../openvswitch-2.7.0/tutorial/simulator/db.sock
// ovs-vswitchd --detach --no-chdir --pidfile -vconsole:off --log-file --enable-dummy=override -vvconn -vnetdev_dummy

func (simulator Simulator) setup() error {
	confdb := simulator.DataFolder + "/conf.db"
	dbsock := simulator.DataFolder + "/db.sock"
	logging.GetLogger().Info("Creating database")
	_, err := execute.ExecCommand(simulator.ovsdbTool, "create", confdb, simulator.ovsSchema)
	if err != nil {
		return err
	}
	logging.GetLogger().Info("Starting ovsdb-server")
	_, err = execute.ExecCommand(simulator.ovsdbServer, "--detach", "--no-chdir", "--pidfile",
		"-vconsole:off", "--log-file", "--remote=punix:"+dbsock)
	if err != nil {
		return err
	}
	logging.GetLogger().Info("Starting vswitchd")
	_, err = execute.ExecCommand(simulator.ovsVswitchd, "--detach", "--no-chdir", "--pidfile",
		"-vconsole:off", "--log-file", "--enable-dummy=override",
		"-vvconn", "-vnetdev_dummy")
	if err != nil {
		err2 := simulator.kill("ovsdb-server")
		if err2 != nil {
			// Just log the error, we are already treating another one.
			logging.GetLogger().Error(err2.Error())
		}
	}
	return err
}

// creaateDir creates the data folder where temporary items are stored.
func createDir(path string) error {
	_, err := os.Stat(path)
	if err == nil || !os.IsNotExist(err) {
		err = os.RemoveAll(path)
		if err != nil {
			return err
		}
	}
	return os.Mkdir(path, 0700)
}

func dedup(nodes *[]*graph.Node) {
	found := make(map[string]bool)
	j := 0
	for i, node := range *nodes {
		id := string(node.ID)
		if !found[id] {
			found[id] = true
			(*nodes)[j] = (*nodes)[i]
			j++
		}
	}
	*nodes = (*nodes)[:j]
}

// AddBridge deploys in the simulator a complete bridge (rules, ports and interfaces) from the nodes
func (sandbox *Sandbox) AddBridge(bridge *graph.Node) error {
	var ids []graph.Identifier
	metadata := bridge.Metadata()
	typ := metadata[keyType].(string)
	if typ != typOvsbridge {
		return fmt.Errorf("Node is not a bridge node: %s", typ)
	}
	logging.GetLogger().Infof("*************  SET UP BRIDGE ***************")
	_, err := sandbox.CreateBridge(bridge)
	if err != nil {
		return err
	}
	ids = append(ids, bridge.ID)
	ports := sandbox.Graph.LookupChildren(bridge, graph.Metadata{keyType: typOvsport}, nil)
	dedup(&ports)
	logging.GetLogger().Infof("Number of ports to connect: %d", len(ports))
	for _, port := range ports {
		interfaces := sandbox.Graph.LookupChildren(port, nil, graph.Metadata{"RelationType": "layer2"})
		dedup(&interfaces)
		idl, err2 := sandbox.CreatePort(bridge, port, interfaces)
		ids = append(ids, idl...)
		if err2 != nil {
			return err
		}

	}

	rules := sandbox.Graph.LookupChildren(bridge, graph.Metadata{keyType: typOfrule}, nil)
	dedup(&rules)
	logging.GetLogger().Infof("Number of rules to establish: %d", len(rules))
	for _, rule := range rules {
		err = sandbox.CreateRule(bridge, rule)
		if err != nil {
			return err
		}
	}
	for _, listener := range sandbox.Simulator.Listeners {
		listener.OnSandboxNodesAdded(sandbox.Time, ids)
	}

	logging.GetLogger().Infof("*************  BRIDGE SET ***************")
	return nil
}

// RemoveBridge remove a bridge from the simulator with all its ports and rules. This function takes care of
// removing from the tables too.
// TODO: move to transactions for unregister too.
func (sandbox *Sandbox) RemoveBridge(bridge *graph.Node) error {
	var ids []graph.Identifier
	n, err := sandbox.DeleteBridge(bridge)
	if err != nil {
		return err
	}
	if n != "" {
		ids = append(ids, bridge.ID)
	}
	ports := sandbox.Graph.LookupChildren(bridge, graph.Metadata{keyType: typOvsport}, nil)
	for _, port := range ports {
		interfaces := sandbox.Graph.LookupChildren(port, nil, graph.Metadata{"RelationType": "layer2"})
		for _, itf := range interfaces {
			_, ok := sandbox.removeNode(itf)
			if ok {
				ids = append(ids, itf.ID)
			}
		}
		_, ok := sandbox.removeNode(port)
		if ok {
			ids = append(ids, port.ID)
		}
	}
	for _, listener := range sandbox.Simulator.Listeners {
		listener.OnSandboxNodesDeleted(sandbox.Time, ids)
	}
	return nil
}

// AddSandbox adds a new sandbox to the simulator
func (simulator *Simulator) AddSandbox(time int64) (*Sandbox, error) {
	sandbox := simulator.Sandboxes[time]
	if sandbox != nil {
		return sandbox, nil
	}
	timeSlice := common.NewTimeSlice(time, time)
	g, err := simulator.Graph.WithContext(graph.GraphContext{TimeSlice: timeSlice})
	if err != nil {
		return nil, err
	}
	sandbox = &Sandbox{
		Time:       time,
		Graph:      g,
		Simulator:  simulator,
		Naming:     make(map[string]*graph.Node),
		BackNaming: make(map[graph.Identifier]string),
	}
	simulator.Sandboxes[time] = sandbox
	for _, listener := range simulator.Listeners {
		listener.OnSandboxAdded(time)
	}
	return sandbox, nil
}

// DeleteSandbox removes a sandbox from the simulator and cleans-up the associated bridge to reclaim resources from the OVS Sandbox.
func (simulator *Simulator) DeleteSandbox(time int64) {
	sandbox := simulator.Sandboxes[time]
	if sandbox == nil {
		return
	}
	for key, node := range sandbox.Naming {
		if key[0] == 'B' {
			err := sandbox.RemoveBridge(node)
			if err != nil {
				logging.GetLogger().Errorf("Did not manaage to remove bridge taagged with %s while cleaning sandbox at %d", key, time)
			}
		}
	}
	for _, listener := range simulator.Listeners {
		listener.OnSandboxDeleted(time)
	}
	delete(simulator.Sandboxes, time)
}

// AddListener registers a new listener for events of changes to simulator state.
func (simulator *Simulator) AddListener(listener SandboxListener) {
	simulator.Listeners = append(simulator.Listeners, listener)
}

// NewSimulatorFromConfig creates a simulator environment
func NewSimulatorFromConfig(g *graph.Graph) (*Simulator, error) {
	enabled := config.GetConfig().GetBool("ovsof.simulator")
	if !enabled {
		return nil, nil
	}
	dataFolder := config.GetConfig().GetString("ovsof.data")
	ovsdbServer := config.GetConfig().GetString("ovsof.ovsdb_server")
	ovsdbTool := config.GetConfig().GetString("ovsof.ovsdb_tool")
	ovsVswitchd := config.GetConfig().GetString("ovsof.ovs_vswitchd")
	ovsSchema := config.GetConfig().GetString("ovsof.ovs_schema")
	ovsAppCtl := config.GetConfig().GetString("ovsof.ovs_appctl")
	ovsOfCtl := config.GetConfig().GetString("ovsof.ovs_ofctl")
	ovsVsCtl := config.GetConfig().GetString("ovsof.ovs_vsctl")
	simulator := &Simulator{
		Sandboxes:   make(map[int64]*Sandbox),
		DataFolder:  dataFolder,
		Graph:       g,
		ovsdbServer: ovsdbServer,
		ovsdbTool:   ovsdbTool,
		ovsVswitchd: ovsVswitchd,
		ovsSchema:   ovsSchema,
		ovsAppCtl:   ovsAppCtl,
		ovsOfCtl:    ovsOfCtl,
		ovsVsCtl:    ovsVsCtl,
	}
	err := setEnvironment(dataFolder)
	if err != nil {
		return nil, err
	}
	err = createDir(dataFolder)
	if err != nil {
		return nil, err
	}
	err = simulator.setup()
	if err != nil {
		return nil, err
	}
	return simulator, nil
}
