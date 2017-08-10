package simulator

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
	"runtime/debug"
	"time"

	auth "github.com/abbot/go-http-auth"
	shttp "github.com/skydive-project/skydive/http"
	"github.com/skydive-project/skydive/logging"
	"github.com/skydive-project/skydive/topology/graph"
)

// API is the interface to the simulator
type API struct {
	simulator *Simulator
	server    *SandboxEventHandler
}

// NewSimulatorAPI creates and register the API to the Openvswitch simulator
func NewSimulatorAPI(g *graph.Graph, http *shttp.Server, ws *shttp.WSMessageServer) *API {
	simulator, err := NewSimulatorFromConfig(g)
	if err != nil {
		logging.GetLogger().Error(err.Error())
	}
	if simulator == nil {
		logging.GetLogger().Info("No Sandbox")
		return nil
	}
	server := NewSandboxEventHandler(simulator, ws)
	sapi := &API{simulator: simulator, server: server}
	sapi.RegisterAPI(http)
	logging.GetLogger().Info("Sandbox registered")
	return sapi
}

// RegisterAPI registers the simulator in the HTTP server
func (sapi *API) RegisterAPI(http *shttp.Server) {
	routes := []shttp.Route{
		{
			Name:        "AddSandbox",
			Method:      "POST",
			Path:        "/api/sandbox/add",
			HandlerFunc: sapi.addSandbox,
		},
		{
			Name:        "RemoveSandbox",
			Method:      "POST",
			Path:        "/api/sandbox/remove",
			HandlerFunc: sapi.removeSandbox,
		},
		{
			Name:        "AddBridge",
			Method:      "POST",
			Path:        "/api/sandbox/register",
			HandlerFunc: sapi.register,
		},
		{
			Name:        "RemoveBridge",
			Method:      "POST",
			Path:        "/api/sandbox/unregister",
			HandlerFunc: sapi.unregister,
		},
		{
			Name:        "Trace",
			Method:      "POST",
			Path:        "/api/sandbox/trace",
			HandlerFunc: sapi.ofprotoTrace,
		},
	}
	http.RegisterRoutes(routes)
}

func replyStatus(w http.ResponseWriter, result interface{}, err error) {
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		if _, e2 := w.Write([]byte(err.Error())); e2 != nil {
			logging.GetLogger().Error(e2.Error())
		}
		return
	}
	w.WriteHeader(http.StatusOK)
	err = json.NewEncoder(w).Encode(result)
	if err != nil {
		logging.GetLogger().Error(err.Error())
	}
}

// SandboxAddParameters are the parameters sent by the client to add or remove a sandbox
type SandboxAddParameters struct {
	Time int64
}

func (sapi *API) getTime(w http.ResponseWriter, r *auth.AuthenticatedRequest) (int64, error) {
	decoder := json.NewDecoder(r.Body)
	var srr SandboxAddParameters
	err := decoder.Decode(&srr)
	if err != nil {
		return -1, err
	}
	time := srr.Time
	return time, nil
}

// SandboxRegisterParameters are the parameters sent by the client to register or unregister a node.
type SandboxRegisterParameters struct {
	Time int64
	TID  string
}

func (sapi *API) getNode(w http.ResponseWriter, r *auth.AuthenticatedRequest) (*Sandbox, *graph.Node, error) {
	decoder := json.NewDecoder(r.Body)
	var srr SandboxRegisterParameters
	err := decoder.Decode(&srr)
	if err != nil {
		return nil, nil, err
	}
	id := srr.TID
	time := srr.Time
	sandbox, ok := sapi.simulator.Sandboxes[time]
	if !ok {
		return nil, nil, fmt.Errorf("No sandbox at time %d", time)
	}
	bnode := sandbox.Graph.LookupFirstNode(graph.Metadata{keyTid: id})
	if bnode == nil {
		return nil, nil, fmt.Errorf("No node with TID %s", id)
	}
	return sandbox, bnode, nil
}

// SandboxQueryParameters are the parameters sent by the client to query the path taken by a packet.
type SandboxQueryParameters struct {
	Time   int64
	TID    string
	Packet string
}

func (sapi *API) getQuery(w http.ResponseWriter, r *auth.AuthenticatedRequest) (*Sandbox, *graph.Node, string, error) {
	decoder := json.NewDecoder(r.Body)
	var srr SandboxQueryParameters
	err := decoder.Decode(&srr)
	if err != nil {
		return nil, nil, "", err
	}
	id := srr.TID
	time := srr.Time
	sandbox, ok := sapi.simulator.Sandboxes[time]
	if !ok {
		return nil, nil, "", fmt.Errorf("no sandbox at time %d", time)
	}
	bnode := sandbox.Graph.LookupFirstNode(graph.Metadata{keyTid: id})
	spec := srr.Packet
	if bnode == nil {
		return nil, nil, "", fmt.Errorf("no node with TID %s", id)
	}
	return sandbox, bnode, spec, nil
}

func (sapi *API) addSandbox(w http.ResponseWriter, r *auth.AuthenticatedRequest) {
	time, err := sapi.getTime(w, r)
	if time == 0 {
		err = fmt.Errorf("cannot add sandbox to time 0")
	}
	if err == nil {
		_, err = sapi.simulator.AddSandbox(time)
	}
	replyStatus(w, []string{"ok"}, err)
}

func (sapi *API) removeSandbox(w http.ResponseWriter, r *auth.AuthenticatedRequest) {
	time, err := sapi.getTime(w, r)
	if err == nil {
		sapi.simulator.DeleteSandbox(time)
	}
	replyStatus(w, []string{"ok"}, err)
}

func (sapi *API) register(w http.ResponseWriter, r *auth.AuthenticatedRequest) {
	defer func() {
		err := r.Body.Close()
		if err != nil {
			logging.GetLogger().Error(err.Error())
		}
	}()
	sandbox, bnode, err := sapi.getNode(w, r)
	if err == nil {
		typ := bnode.Metadata()[keyType].(string)
		switch typ {
		case typHost:
			bridges := sandbox.Graph.LookupChildren(bnode, graph.Metadata{keyType: typOvsbridge}, nil)
			for _, bridge := range bridges {
				err = sandbox.AddBridge(bridge)
				if err != nil {
					break
				}
			}
		case typOvsbridge:
			err = sandbox.AddBridge(bnode)
		default:
			err = fmt.Errorf("Can only add bridge or host to sandbox: %s", typ)
		}
	}
	replyStatus(w, []string{"ok"}, err)
}

func (sapi *API) unregister(w http.ResponseWriter, r *auth.AuthenticatedRequest) {
	defer func() {
		err := r.Body.Close()
		if err != nil {
			logging.GetLogger().Error(err.Error())
		}
	}()
	sandbox, bnode, err := sapi.getNode(w, r)
	if err == nil {
		typ := bnode.Metadata()[keyType].(string)
		switch typ {
		case typHost:
			bridges := sandbox.Graph.LookupChildren(bnode, graph.Metadata{keyType: typOvsbridge}, nil)
			for _, bridge := range bridges {
				err = sandbox.RemoveBridge(bridge)
				if err != nil {
					break
				}
			}
		case typOvsbridge:
			err = sandbox.RemoveBridge(bnode)
		default:
			err = fmt.Errorf("Can only add bridge or host to sandbox: %s", typ)
		}
	}
	replyStatus(w, []string{"ok"}, err)
}

func (sapi *API) ofprotoTrace(w http.ResponseWriter, r *auth.AuthenticatedRequest) {

	sandbox, bnode, spec, err := sapi.getQuery(w, r)
	if err != nil {
		replyStatus(w, "", errors.New("Bad arguments: "+err.Error()))
		return
	}
	name, _, ok := sandbox.getSandboxID(bnode)
	logging.GetLogger().Infof("Launch ofproto/trace with %s / %s", name, spec)
	if ok {
		path, err := sandbox.Trace(name, spec)
		replyStatus(w, path, err)
	} else {
		replyStatus(w, "", errors.New("Unknown bridge"))
	}

}

// **********************************************************************

func dumper() {
	time.Sleep(time.Second * 90)
	logging.GetLogger().Info("****************** MAKING A HEAP DUMP *******************")
	f, err := ioutil.TempFile("/tmp", "godump")
	if err != nil {
		logging.GetLogger().Error(err.Error())
		return
	}
	debug.WriteHeapDump(f.Fd())
	err = f.Close()
	if err != nil {
		logging.GetLogger().Error(err.Error())
	}
	logging.GetLogger().Info("********************************************************")
}

// Debug makes a heap dump after 1mn30
func Debug() {
	go dumper()
}
