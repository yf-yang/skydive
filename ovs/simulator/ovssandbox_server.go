package simulator

import (
	shttp "github.com/skydive-project/skydive/http"
	"github.com/skydive-project/skydive/topology/graph"
)

/*
Constants defining the message that can be exchanged between the GUI and the analyzer.
*/
const (
	SandboxSyncRequestMsgType  = "SandboxSyncRequest"
	SandboxSyncReplyMsgType    = "SandboxSyncReply"
	SandboxAddedMsgType        = "SandboxAdded"
	SandboxDeletedMsgType      = "SandboxDeleted"
	SandboxNodesAddedMsgType   = "SandboxNodesAdded"
	SandboxNodesDeletedMsgType = "SandboxNodesDeleted"
)

// Namespace is the namespace used for Websocket messages
const Namespace = "Sandbox"

// SandboxEventHandler is the structure used by websocket server handling messages to/from the GUI for managing the state of sandboxes.
type SandboxEventHandler struct {
	WSServer  *shttp.WSMessageServer
	simulator *Simulator
}

// SandboxDescription describes the content of a sandbox. Its JSON representation is used by WebSocket messages.
type SandboxDescription struct {
	// Time is the date of sandbox creation.
	Time int64
	// Nodes are the ID of all the nodes contained in the sandbox.
	Nodes []graph.Identifier
}

// OnMessage replies to the Sync request messages coming from the GUI.
func (s *SandboxEventHandler) OnWSMessage(c shttp.WSClient, msg shttp.WSMessage) {
	switch msg.Type {
	case SandboxSyncRequestMsgType:
		sandboxes := make([]SandboxDescription, len(s.simulator.Sandboxes))
		i := 0
		for _, sandbox := range s.simulator.Sandboxes {
			sandboxes[i].Time = sandbox.Time
			names := make([]graph.Identifier, len(sandbox.Naming))
			j := 0
			for name := range sandbox.BackNaming {
				names[j] = name
				j++
			}
			sandboxes[i].Nodes = names
			i++
		}
		reply := shttp.NewWSMessage(Namespace, SandboxSyncReplyMsgType, sandboxes)
		c.Send(reply)
	}

}

// OnSandboxAdded from SandboxListener
func (s *SandboxEventHandler) OnSandboxAdded(date int64) {
	s.WSServer.BroadcastMessage(shttp.NewWSMessage(Namespace, SandboxAddedMsgType, date))
}

// OnSandboxDeleted from SandboxListener
func (s *SandboxEventHandler) OnSandboxDeleted(date int64) {
	s.WSServer.BroadcastMessage(shttp.NewWSMessage(Namespace, SandboxDeletedMsgType, date))
}

// OnSandboxNodesAdded from SandboxListener
func (s *SandboxEventHandler) OnSandboxNodesAdded(date int64, nodes []graph.Identifier) {
	msg := SandboxDescription{
		Time:  date,
		Nodes: nodes,
	}
	s.WSServer.BroadcastMessage(shttp.NewWSMessage(Namespace, SandboxNodesAddedMsgType, msg))
}

// OnSandboxNodesDeleted from SandboxListener
func (s *SandboxEventHandler) OnSandboxNodesDeleted(date int64, nodes []graph.Identifier) {
	msg := SandboxDescription{
		Time:  date,
		Nodes: nodes,
	}
	s.WSServer.BroadcastMessage(shttp.NewWSMessage(Namespace, SandboxNodesDeletedMsgType, msg))
}

// NewSandboxEventHandler creates a new Websocket handler that manage messages related to the sandbox.
func NewSandboxEventHandler(simulator *Simulator, server *shttp.WSMessageServer) *SandboxEventHandler {
	s := &SandboxEventHandler{
		simulator: simulator,
		WSServer:  server,
	}
	server.AddMessageHandler(s, []string{Namespace})
	simulator.AddListener(s)
	return s
}
