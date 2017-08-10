package simulator

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	logging "github.com/skydive-project/skydive/logging"
	"github.com/skydive-project/skydive/topology/graph"
)

// TraceElement represents a fragment of an ofproto/trace result
type TraceElement struct {
	Rule  *graph.Node
	Event string
}

// TraceBridge is a set of TraceElements occuring on a same bridge.
type TraceBridge struct {
	Bridge *graph.Node
	Path   []*TraceElement
}

// Trace represents an ofproto/trace result
type Trace struct {
	Flow string
	Path []*TraceBridge
}

var reFilterLine = regexp.MustCompile(`(^[ ]*([0-9]*)\.[ ]+)(?:([^ ]+), )?priority ([0-9]*)(?:, cookie ([0-9a-fx]*))?$`)
var reEventLine = regexp.MustCompile("^[ ]*-> (.*)$")
var reFilterNoMatch = regexp.MustCompile(`^[ ]*([0-9]*)\.[ ]+No match\.$`)

func parseSafeInt(s string) int {
	if s == "" {
		return 0
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		logging.GetLogger().Errorf("Problem while parsing integer in of/proto trace output for %s", s)
	}
	return v
}

func (sandbox *Sandbox) findRule(bridge *graph.Node, table int, priority int, cookie string, filter string, actions string) *graph.Node {
	var extFilter string
	rules := sandbox.Graph.LookupChildren(bridge, graph.Metadata{keyType: typOfrule, "table": int64(table), "priority": int64(priority), "cookie": cookie}, nil)
	logging.GetLogger().Debugf("Filtering on priority=%d table=%d cookie=%s", priority, table, cookie)
	logging.GetLogger().Debugf("Looking for %d - %s ==> %s", priority, filter, actions)
	if filter == "" {
		extFilter = fmt.Sprintf("priority=%d", priority)
	} else {
		extFilter = fmt.Sprintf("priority=%d,%s", priority, filter)
	}
	var ruleFilter string
	for _, rule := range rules {
		metadata := rule.Metadata()
		logging.GetLogger().Debugf("   '%s' ==> '%s' / %s", metadata["filters"], metadata["actions"], extFilter)
		ruleFilter = metadata["filters"].(string)
		if ruleFilter == extFilter {
			logging.GetLogger().Debug("Match found")
			return rule
		}
	}
	return nil
}

func (sandbox *Sandbox) parseBridgeTrace(trace *Trace, bridge *graph.Node, lines []string, i int) (int, error) {
	var currentTrace *TraceElement
	var currentPath []*TraceElement
	for i < len(lines) {
		line := lines[i]
		i = i + 1
		if len(line) == 0 {
			break
		}
		frags := reFilterLine.FindStringSubmatch(line)
		if len(frags) == 6 {
			if i == len(lines) {
				return 0, fmt.Errorf("Missing action for rule with filter: %s", line)
			}
			expectedWhitespace := len(frags[1])
			actions := ""
			for i < len(lines) {
				action := strings.Trim(lines[i], " \t")
				if len(action)+expectedWhitespace != len(lines[i]) {
					break
				}
				actions = actions + "," + action
				i = i + 1
			}

			table := parseSafeInt(frags[2])
			priority := parseSafeInt(frags[4])
			filters := frags[3]
			cookie := frags[5]
			if cookie == "" {
				cookie = "0x0"
			}

			rule := sandbox.findRule(bridge, table, priority, cookie, filters, actions)
			currentTrace = &TraceElement{
				Rule: rule,
			}
			if rule != nil {
				currentPath = append(currentPath, currentTrace)
			} else {
				logging.GetLogger().Errorf("Cannot find rule for line: %s", line)
			}
			continue
		}
		frags = reFilterNoMatch.FindStringSubmatch(line)
		if len(frags) == 2 {
			if i == len(lines) {
				return 0, fmt.Errorf("Missing action for rule with filter: %s", line)
			}
			actions := strings.Trim(lines[i], " \t")
			i = i + 1
			currentTrace = &TraceElement{
				Rule:  nil,
				Event: actions,
			}
			currentPath = append(currentPath, currentTrace)
			currentTrace = nil
			continue
		}
		frags = reEventLine.FindStringSubmatch(line)
		if len(frags) == 2 {
			currentTrace.Event = frags[1]
		} else {
			return 0, fmt.Errorf("Don't know what to do with %s", line)
		}
	}
	bridgePath := &TraceBridge{
		Bridge: bridge,
		Path:   currentPath,
	}
	trace.Path = append(trace.Path, bridgePath)
	return i, nil
}

// Trace launches a ofproto/trace in the simulator and gives back a parsed result.
func (sandbox *Sandbox) Trace(brname string, spec string) (*Trace, error) {
	output, err := execute.ExecCommand(sandbox.Simulator.ovsAppCtl, "ofproto/trace", brname, spec)
	lines := strings.Split(string(output), "\n")
	var i = 0
	var result = &Trace{}
	for i < len(lines) {
		line := lines[i]
		i = i + 1
		if strings.HasPrefix(line, "Flow:") {
			// parse the flow line
			result.Flow = line[5:]
			break
		}
	}
	for i < len(lines) {
		line := lines[i]
		i = i + 1
		if len(line) == 0 {
			continue
		}
		if line[0] == ' ' {
			line = strings.TrimLeft(line, " ")
		}
		if strings.HasPrefix(line, "bridge") {
			frags := strings.Split(line, "\"")
			// extract the bridge
			if len(frags) != 3 {
				return nil, fmt.Errorf("Cannot parse bridge line: %s", line)
			}
			currentBridge := sandbox.Naming[frags[1]]
			i = i + 1 // skip the dash line.
			i, err = sandbox.parseBridgeTrace(result, currentBridge, lines, i)
			if err != nil {
				return nil, err
			}
		} else {
			logging.GetLogger().Infof("Assume parsing is finished: %q", lines[i-1:])
			break
		}

	}
	return result, err
}
