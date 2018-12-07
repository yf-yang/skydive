/*
 * Copyright (C) 2018 Orange
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

package nsm

import (
	"context"
	//"flag"
	"net"
	//	"path/filepath"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/empty"
	cc "github.com/ligato/networkservicemesh/controlplane/pkg/apis/crossconnect"
	localconn "github.com/ligato/networkservicemesh/controlplane/pkg/apis/local/connection"
	remoteconn "github.com/ligato/networkservicemesh/controlplane/pkg/apis/remote/connection"
	"github.com/ligato/networkservicemesh/k8s/pkg/networkservice/clientset/versioned"
	"github.com/skydive-project/skydive/common"
	"github.com/skydive-project/skydive/filters"
	"github.com/skydive-project/skydive/logging"
	"github.com/skydive-project/skydive/topology/graph"
	"google.golang.org/grpc"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	//"k8s.io/client-go/tools/clientcmd"
	//"k8s.io/client-go/util/homedir"
)

type connection interface {
	onEventDelete(*graph.Graph)
	onEventUpdate(*graph.Graph)
}

// baseConnectionPair base class of connections
type baseConnectionPair struct {
	payload  string
	srcInode int64
	dstInode int64
	src      *localconn.Connection
	dst      *localconn.Connection
}

type localConnectionPair struct {
	baseConnectionPair
	ID string
}

type remoteConnectionPair struct {
	baseConnectionPair
	bridge *remoteconn.Connection
	srcID  string
	dstID  string
}

// easyjson:json
type baseConnectionMetadata struct {
	MechanismType       string
	MechanismParameters map[string]string
	Labels              map[string]string
}

// easyjson:json
type localConnectionMetadata struct {
	IP                  string
	baseConnectionMetadata
}

// easyjson:json
type remoteConnectionMetadata struct {
	baseConnectionMetadata
	SourceNSM              string
	DestinationNSM         string
	NetworkServiceEndpoint string
}

// easyjson:json
type baseNSMMetadata struct {
	NetworkService string
	Payload        string
	Source         interface{}
	Destination    interface{}
	Directed       string
}

// easyjson:json
type localNSMMetadata struct {
	CrossConnectID string
	baseNSMMetadata
}

// easyjson:json
type remoteNSMMetadata struct {
	SourceCrossConnectID      string
	DestinationCrossConnectID string
	baseNSMMetadata
	Via remoteConnectionMetadata
}

func getNode(inode int64, g *graph.Graph) *graph.Node {
	filter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", inode))
	node := g.LookupFirstNode(filter)
	if node == nil {
		logging.GetLogger().Errorf("NSM: no node with inode %v", inode)
	}
	return node
}

func (pair *localConnectionPair) onEventUpdate(g *graph.Graph) {
	g.Lock()
	defer g.Unlock()
	s := getNode(pair.srcInode, g)
	d := getNode(pair.dstInode, g)
	if s == nil || d == nil {
		return
	}
	metadata := graph.Metadata{
		"NSM": localNSMMetadata{
			CrossConnectID: pair.ID,
			baseNSMMetadata: baseNSMMetadata{
				NetworkService: pair.src.GetNetworkService(),
				Payload:        pair.payload,
				Source: localConnectionMetadata{
					IP: pair.src.GetContext()["src_ip"],
					baseConnectionMetadata: baseConnectionMetadata{
						MechanismType:       pair.src.GetMechanism().GetType().String(),
						MechanismParameters: pair.src.GetMechanism().GetParameters(),
						Labels:              pair.src.GetLabels(),
					},
				},
				Destination: localConnectionMetadata{
					IP: pair.src.GetContext()["dst_ip"],
					baseConnectionMetadata: baseConnectionMetadata{
						MechanismType:       pair.dst.GetMechanism().GetType().String(),
						MechanismParameters: pair.dst.GetMechanism().GetParameters(),
						Labels:              pair.dst.GetLabels(),
					},
				},
				Directed: "true",
			},
		},
	}
	if !g.AreLinked(s, d, nil) {
		g.NewEdge(
			graph.GenID(), s, d,
			metadata)
		logging.GetLogger().Debugf("NSM: Add local link for Xcon %v", pair.ID)
	} else {
		logging.GetLogger().Debugf("NSM: link for local crossconnect id %v already exist in the graph", pair.ID)
	}
}
func (pair *localConnectionPair) onEventDelete(g *graph.Graph) {
	g.Lock()
	defer g.Unlock()
}

func (pair *remoteConnectionPair) onEventUpdate(g *graph.Graph) {
	if pair.src == nil || pair.dst == nil {
		return
	}
	g.Lock()
	defer g.Unlock()
	s := getNode(pair.srcInode, g)
	d := getNode(pair.dstInode, g)
	if s == nil || d == nil {
		return
	}
	metadata := graph.Metadata{
		"NSM": remoteNSMMetadata{
			SourceCrossConnectID:      pair.srcID,
			DestinationCrossConnectID: pair.dstID,
			baseNSMMetadata: baseNSMMetadata{
				NetworkService: pair.src.GetNetworkService(),
				Payload:        pair.payload,
				Source: localConnectionMetadata{
					IP: pair.src.GetContext()["src_ip"],
					baseConnectionMetadata: baseConnectionMetadata{
						MechanismType:       pair.src.GetMechanism().GetType().String(),
						MechanismParameters: pair.src.GetMechanism().GetParameters(),
						Labels:              pair.src.GetLabels(),
					},
				},
				Destination: localConnectionMetadata{
					IP: pair.src.GetContext()["dst_ip"],
					baseConnectionMetadata: baseConnectionMetadata{
						MechanismType:       pair.dst.GetMechanism().GetType().String(),
						MechanismParameters: pair.dst.GetMechanism().GetParameters(),
						Labels:              pair.dst.GetLabels(),
					},
				},
				Directed: "true",
			},
			Via:	remoteConnectionMetadata{
				baseConnectionMetadata: baseConnectionMetadata{
					MechanismType:       pair.bridge.GetMechanism().GetType().String(),
					MechanismParameters: pair.bridge.GetMechanism().GetParameters(),
					Labels:              pair.bridge.GetLabels(),
				},
				SourceNSM:              pair.bridge.GetSourceNetworkServiceManagerName(),
				DestinationNSM:         pair.bridge.GetDestinationNetworkServiceManagerName(),
				NetworkServiceEndpoint: pair.bridge.GetNetworkServiceEndpointName(),
			},
		},
	}
	if !g.AreLinked(s, d, nil) {
		g.NewEdge(
			graph.GenID(), s, d,
			metadata)
		logging.GetLogger().Debugf("NSM: Add local link for remote Xcon pair %v & %v", pair.srcID, pair.dstID)
	} else {
		logging.GetLogger().Debugf("NSM: link for remote crossconnect id %v & %v already exist in the graph", pair.srcID, pair.dstID)
	}
}
func (pair *remoteConnectionPair) onEventDelete(g *graph.Graph) {
	if pair.src == nil || pair.dst == nil {
		return
	}
	g.Lock()
	defer g.Unlock()
}

type iNodeBuffer struct {
	inodeAvail bool
	// mapping from crossConnectID to connections
	connections map[string]connection
}

type lookUpTableElement struct {
	inode          int64
	crossConnectID string
}

// Probe ...
type Probe struct {
	common.Mutex
	graph.DefaultGraphListener
	g     *graph.Graph
	state int64
	nsmds map[string]*grpc.ClientConn
	// mapping from iNode to correponding connections
	iNodeConnectionPool map[int64]*iNodeBuffer
	// mapping from bridgeID to iNode & crossConnectID designed for remote connections
	remoteLookUpTable map[string]*lookUpTableElement
}

func (p *Probe) run() {
	atomic.StoreInt64(&p.state, common.RunningState)

	logging.GetLogger().Debugf("NSM: running probe")

	// check if CRD is installed
	config, err := rest.InClusterConfig()
	if err != nil {
		logging.GetLogger().Errorf("Unable to get in cluster config, attempting to fall back to kubeconfig", err)
		return
	}

	logging.GetLogger().Debugf("NSM: getting NSM client")
	// Initialize clientset
	nsmClientSet, err := versioned.NewForConfig(config)
	if err != nil {
		logging.GetLogger().Errorf("Unable to initialize nsmd-k8s", err)
		return
	}

	result, err := nsmClientSet.Networkservicemesh().NetworkServiceManagers("default").List(metav1.ListOptions{})
	if err != nil {
		logging.GetLogger().Errorf("Unable to find NSMs, are they running?", err)
		return
	}
	for _, mgr := range result.Items {
		//TODO: loop each nsmd servers monitoring in dedicated goroutines
		if _, ok := p.nsmds[mgr.Status.URL]; !ok {

			logging.GetLogger().Infof("Found nsmd: %s at %s", mgr.Name, mgr.Status.URL)
			go p.monitorCrossConnects(mgr.Status.URL)
		}
	}
	for atomic.LoadInt64(&p.state) == common.RunningState {

		time.Sleep(1 * time.Second)
	}
}

func (p *Probe) monitorCrossConnects(url string) {
	var err error
	p.nsmds[url], err = dial(context.Background(), "tcp", url)
	if err != nil {
		logging.GetLogger().Errorf("NSM: unable to create grpc dialer, error: %+v", err)
		return
	}

	client := cc.NewMonitorCrossConnectClient(p.nsmds[url])
	//TODO: grpc is automagically trying to reconnect
	// better understand the process to handle corner cases
	stream, err := client.MonitorCrossConnects(context.Background(), &empty.Empty{})
	if err != nil {
		logging.GetLogger().Errorf("NSM: unable to connect to grpc server, error: %+v.", err)
		return
	}

	for {
		logging.GetLogger().Debugf("NSM: waiting for events")
		event, err := stream.Recv()
		logging.GetLogger().Debugf("NSM: received monitoring event of type %s", event.Type)
		if err != nil {
			logging.GetLogger().Errorf("Error: %+v.", err)
			return
		}

		for _, cconn := range event.GetCrossConnects() {
			cconnStr := proto.MarshalTextString(cconn)

			lSrc := cconn.GetLocalSource()
			rSrc := cconn.GetRemoteSource()
			lDst := cconn.GetLocalDestination()
			rDst := cconn.GetRemoteDestination()

			switch {
			case lSrc != nil && rSrc == nil && lDst != nil && rDst == nil:
				logging.GetLogger().Debugf("NSM: Got local to local CrossConnect Msg \n%s", cconnStr)
				p.onConnLocalLocal(event.GetType(), cconn.GetId(), cconn.GetPayload(), lSrc, lDst)
			case lSrc == nil && rSrc != nil && lDst != nil && rDst == nil:
				logging.GetLogger().Debugf("NSM: Got remote to local CrossConnect Msg \n%s", cconnStr)
				p.onConnRemoteLocal(event.GetType(), cconn.GetId(), cconn.GetPayload(), rSrc, lDst)
			case lSrc != nil && rSrc == nil && lDst == nil && rDst != nil:
				logging.GetLogger().Debugf("NSM: Got local to remote CrossConnect Msg \n%s", cconnStr)
				p.onConnLocalRemote(event.GetType(), cconn.GetId(), cconn.GetPayload(), lSrc, rDst)
			default:
				logging.GetLogger().Errorf("Error parsing CrossConnect \n%s", cconnStr)
			}
		}
	}
}

// OnNodeAdded event
func (p *Probe) OnNodeAdded(n *graph.Node) {
	if i, err := n.GetFieldInt64("Inode"); err == nil {
		logging.GetLogger().Debugf("NSM: node added with inode %v", i)
		go func() {
			p.Lock()
			defer p.Unlock()
			nodeBuf := p.tryGetBuffer(i)
			nodeBuf.inodeAvail = true
			for _, pair := range nodeBuf.connections {
				go pair.onEventUpdate(p.g)
			}
		}()
	}
}

// OnNodeDeleted event
func (p *Probe) OnNodeDeleted(n *graph.Node) {
	if i, err := n.GetFieldInt64("Inode"); err == nil {
		logging.GetLogger().Debugf("NSM: node deleted with inode %v", i)
		go func() {
			p.Lock()
			defer p.Unlock()
			nodeBuf := p.iNodeConnectionPool[i]
			nodeBuf.inodeAvail = false
			for _, pair := range nodeBuf.connections {
				pair.onEventDelete(p.g)
			}
			p.tryDeleteBuffer(i)
		}()
	}
}

// Start ...
func (p *Probe) Start() {
	p.g.AddEventListener(p)
	go p.run()
}

// Stop ....
func (p *Probe) Stop() {
	atomic.CompareAndSwapInt64(&p.state, common.RunningState, common.StoppingState)
	p.g.RemoveEventListener(p)
	for _, conn := range p.nsmds {
		conn.Close()
	}
}

// NewNsmProbe ...
func NewNsmProbe(g *graph.Graph) (*Probe, error) {
	probe := &Probe{
		g:                   g,
		nsmds:               make(map[string]*grpc.ClientConn),
		iNodeConnectionPool: make(map[int64]*iNodeBuffer),
		remoteLookUpTable:   make(map[string]*lookUpTableElement),
	}
	atomic.StoreInt64(&probe.state, common.StoppedState)
	return probe, nil
}

func dial(ctx context.Context, network string, address string) (*grpc.ClientConn, error) {
	conn, err := grpc.DialContext(ctx, address, grpc.WithInsecure(), grpc.WithBlock(),
		grpc.WithDialer(func(addr string, timeout time.Duration) (net.Conn, error) {
			return net.Dial(network, addr)
		}),
	)
	return conn, err
}

func monitorNSM(client cc.MonitorCrossConnectClient) {
	//wait for a chan to close conn?
}

//TODO: consider moving this function to
// https://github.com/ligato/networkservicemesh/blob/master/controlplane/pkg/apis/local/connection/mechanism_helpers.go
func getLocalInode(conn *localconn.Connection) (int64, error) {
	inodeStr := conn.Mechanism.Parameters[localconn.NetNsInodeKey]
	inode, err := strconv.ParseInt(inodeStr, 10, 64)
	if err != nil {
		logging.GetLogger().Errorf("NSM: error converting inode %s to int64", inodeStr)
		return 0, err
	}
	return inode, nil
}

func (p *Probe) tryGetBuffer(inode int64) *iNodeBuffer {
	NodeBuf, ok := p.iNodeConnectionPool[inode]
	if !ok {
		NodeBuf = &iNodeBuffer{
			connections: make(map[string]connection),
		}
		p.iNodeConnectionPool[inode] = NodeBuf
	}
	return NodeBuf
}

func (p *Probe) tryDeleteBuffer(inode int64) {
	nodeBuf, ok := p.iNodeConnectionPool[inode]
	if !ok {
		logging.GetLogger().Errorf("Inode not found %v", inode)
		return
	}
	if !nodeBuf.inodeAvail && len(nodeBuf.connections) == 0 {
		delete(p.iNodeConnectionPool, inode)
		logging.GetLogger().Debugf("Remove Inode %v", inode)
	}
}

func (p *Probe) deleteConnectionPair(inode int64, id string) (connection, bool) {
	nodeBuf, ok := p.iNodeConnectionPool[inode]
	if !ok {
		logging.GetLogger().Errorf("Inode not found %v", inode)
		return nil, false
	}
	pair, ok := nodeBuf.connections[id]
	if !ok {
		logging.GetLogger().Errorf("Crossconnect %s not found in Inode %v", id, inode)
		return nil, false
	}
	delete(nodeBuf.connections, id)
	logging.GetLogger().Errorf("Remove Crossconnect %s from Inode %v", id, inode)
	return pair, nodeBuf.inodeAvail
}

func (p *Probe) onConnLocalLocal(t cc.CrossConnectEventType, id string, payload string,
	src *localconn.Connection, dst *localconn.Connection) {

	srcInode, err := getLocalInode(src)
	if err != nil {
		return
	}
	dstInode, err := getLocalInode(dst)
	if err != nil {
		return
	}

	p.Lock()
	defer p.Unlock()
	if t != cc.CrossConnectEventType_DELETE {
		srcNodeBuf := p.tryGetBuffer(srcInode)
		dstNodeBuf := p.tryGetBuffer(dstInode)
		pair := &localConnectionPair{
			baseConnectionPair: baseConnectionPair{
				payload:  payload,
				srcInode: srcInode,
				dstInode: dstInode,
				src:      src,
				dst:      dst,
			},
			ID: id,
		}
		srcNodeBuf.connections[id] = pair
		dstNodeBuf.connections[id] = pair

		if srcNodeBuf.inodeAvail && dstNodeBuf.inodeAvail {
			pair.onEventUpdate(p.g)
		}
	} else {
		srcPair, srcInodeAvail := p.deleteConnectionPair(srcInode, id)
		dstPair, dstInodeAvail := p.deleteConnectionPair(dstInode, id)
		if srcInodeAvail && dstInodeAvail {
			switch {
			case srcPair != nil:
				srcPair.onEventDelete(p.g)
			case dstPair != nil:
				dstPair.onEventDelete(p.g)
			default:
				logging.GetLogger().Errorf("Local Connection %s lost", id)
			}
		}
		p.tryDeleteBuffer(srcInode)
		p.tryDeleteBuffer(dstInode)
	}
}

func (p *Probe) onConnRemoteLocal(t cc.CrossConnectEventType, id string, payload string,
	src *remoteconn.Connection, dst *localconn.Connection) {
	dstInode, err := getLocalInode(dst)
	if err != nil {
		return
	}

	bridgeID := src.GetId()
	p.Lock()
	defer p.Unlock()
	if t != cc.CrossConnectEventType_DELETE {
		dstNodeBuf := p.tryGetBuffer(dstInode)

		srcEle, ok := p.remoteLookUpTable[bridgeID]
		if !ok {
			// the other xcon is not available
			pair := &remoteConnectionPair{
				baseConnectionPair: baseConnectionPair{
					payload:  payload,
					dstInode: dstInode,
					dst:      dst,
				},
				bridge: src,
				dstID:  id,
			}
			dstNodeBuf.connections[id] = pair
			p.remoteLookUpTable[bridgeID] = &lookUpTableElement{
				inode:          dstInode,
				crossConnectID: id,
			}
		} else {
			srcNodeBuf := p.iNodeConnectionPool[srcEle.inode]
			pair := srcNodeBuf.connections[srcEle.crossConnectID].(*remoteConnectionPair)
			if !proto.Equal(pair.bridge, src) {
				logging.GetLogger().Errorf("Different Remote Connection with id %s.", bridgeID)
				return
			}
			pair.baseConnectionPair.dstInode = dstInode
			pair.baseConnectionPair.dst = dst
			pair.dstID = id
			dstNodeBuf.connections[id] = pair
			delete(p.remoteLookUpTable, bridgeID)
			if srcNodeBuf.inodeAvail && dstNodeBuf.inodeAvail {
				pair.onEventUpdate(p.g)
			}
		}
	} else {
		pair, dstInodeAvail := p.deleteConnectionPair(dstInode, id)
		dstPair := pair.(*remoteConnectionPair)
		if dstInodeAvail {
			dstPair.onEventDelete(p.g)
		}
		// // In case one xcon is replaced (could that really happen?)
		// p.remoteLookUpTable[bridgeID] = &lookUpTableElement {
		// 	inode: dstInode,
		// 	crossConnectID: id,
		// }
		dstPair.baseConnectionPair.dstInode = 0
		dstPair.baseConnectionPair.dst = nil
		dstPair.dstID = ""
		p.tryDeleteBuffer(dstInode)
	}
}

func (p *Probe) onConnLocalRemote(t cc.CrossConnectEventType, id string, payload string,
	src *localconn.Connection, dst *remoteconn.Connection) {
	srcInode, err := getLocalInode(src)
	if err != nil {
		return
	}

	bridgeID := dst.GetId()
	p.Lock()
	defer p.Unlock()
	if t != cc.CrossConnectEventType_DELETE {
		srcNodeBuf := p.tryGetBuffer(srcInode)

		dstEle, ok := p.remoteLookUpTable[bridgeID]
		if !ok {
			// the other xcon is not available
			pair := &remoteConnectionPair{
				baseConnectionPair: baseConnectionPair{
					payload:  payload,
					srcInode: srcInode,
					src:      src,
				},
				bridge: dst,
				srcID:  id,
			}
			srcNodeBuf.connections[id] = pair
			p.remoteLookUpTable[bridgeID] = &lookUpTableElement{
				inode:          srcInode,
				crossConnectID: id,
			}
		} else {
			dstNodeBuf := p.iNodeConnectionPool[dstEle.inode]
			pair := dstNodeBuf.connections[dstEle.crossConnectID].(*remoteConnectionPair)
			if !proto.Equal(pair.bridge, dst) {
				logging.GetLogger().Errorf("Different Remote Connection with id %s.", bridgeID)
				return
			}
			pair.baseConnectionPair.srcInode = srcInode
			pair.baseConnectionPair.src = src
			pair.srcID = id
			srcNodeBuf.connections[id] = pair
			delete(p.remoteLookUpTable, bridgeID)
			if dstNodeBuf.inodeAvail && srcNodeBuf.inodeAvail {
				pair.onEventUpdate(p.g)
			}
		}
	} else {
		pair, srcInodeAvail := p.deleteConnectionPair(srcInode, id)
		srcPair := pair.(*remoteConnectionPair)
		if srcInodeAvail {
			srcPair.onEventDelete(p.g)
		}
		// // In case one xcon is replaced (could that really happen?)
		// p.remoteLookUpTable[bridgeID] = &lookUpTableElement {
		// 	inode: srcInode,
		// 	crossConnectID: id,
		// }
		srcPair.baseConnectionPair.srcInode = 0
		srcPair.baseConnectionPair.src = nil
		srcPair.srcID = ""
		p.tryDeleteBuffer(srcInode)
	}
}
