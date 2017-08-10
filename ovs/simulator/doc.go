/*
Package simulator provides a way to simulate a set of Openvswitch and trace packets in those simulated switch.

simulator uses Openvswitch sandbox (an openvswitch user space daemon without corresponding kernel dataplane) to
create a model of a set of bridges. A sandbox is a moodel of a set of bridges taken from the skydive graph model
identified by the time of the snapshot.

Links between bridges through patch ports are preserved. Additional links between bridges representing external
connectivity may be added in the future if we find a way to correctly emulate connections between bridges. As the
ports and interfaces respect the Openflow numbering of the model, Openflow rules can be directly copied from the
graph to the sandbox.

It is possible to use ovs-appctl ofproto/trace on the sandbox to get the path of a packet. This trace is
reinterpreted to be transformed in a sequence of rules (a sequence of graph nodes) that can be given back to
the GUI for display. More formally, the returned value is a tree as several packets may be generated from a single
packet.

The dialog is the following:

- HTTPserver is used to change the simulator state : add or remove a sandbox, add or remove a bridge
(with its ports and rules) and to trigger traces.

- WebSocket are used to maintain in the GUI the state of the simulator : sandbox list, sandbox events
(creation, deletion) objects added or removed.

*/
package simulator
