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

// remoteConnectionPair ...
type remoteConnectionPair struct {
	srcId   string
	dstId   string
	payload string
	src     *localconn.Connection
	dst     *localconn.Connection
	bridge  *remoteconn.Connection
}

type crossConnInodes struct {
	src int64
	dst int64
	ns  string
}

// Probe ...
type Probe struct {
	g              *graph.Graph
	state          int64
	nsmds          map[string]*grpc.ClientConn
	remoteConnPool map[string]*remoteConnectionPair
	crossConn      map[string]*crossConnInodes
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

		for _, cconn := range event.CrossConnects {
			cconnStr := proto.MarshalTextString(cconn)

			lSrc := cconn.GetLocalSource()
			rSrc := cconn.GetRemoteSource()
			lDst := cconn.GetLocalDestination()
			rDst := cconn.GetRemoteDestination()

			switch {
			case lSrc != nil && rSrc == nil && lDst != nil && rDst == nil:
				logging.GetLogger().Debugf("NSM: Got local to local CrossConnect Msg \n%s", cconnStr)
				p.updateLocalLocalConn(event.Type, cconn.Id, cconn.Payload, lSrc, lDst)
			case lSrc == nil && rSrc != nil && lDst != nil && rDst == nil:
				p.updateRemoteLocalConn(event.Type, cconn.Id, cconn.Payload, rSrc, lDst)
			case lSrc != nil && rSrc == nil && lDst == nil && rDst != nil:
				p.updateLocalRemoteConn(event.Type, cconn.Id, cconn.Payload, lSrc, rDst)
			default:
				logging.GetLogger().Errorf("Error parsing CrossConnect \n%s", cconnStr)
			}
		}
	}
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

func (p *Probe) updateLocalLocalConn(t cc.CrossConnectEventType, id string, payload string,
	src *localconn.Connection, dst *localconn.Connection) {
	p.g.Lock()
	defer p.g.Unlock()

	srcInode, err := getLocalInode(src)
	if err != nil {
		return
	}
	dstInode, err := getLocalInode(dst)
	if err != nil {
		return
	}
	p.crossConn[id] = &crossConnInodes{src: srcInode, dst: dstInode, ns: src.NetworkService}

	if t != cc.CrossConnectEventType_DELETE {
		p.addCrossConnToGraph()
	}
	//TODO manage deletion
}
func (p *Probe) nodeExists(inode int64) *graph.Node {
	filter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", inode))
	node := p.g.LookupFirstNode(filter)
	if node == nil {
		logging.GetLogger().Debugf("NSM: no node with inode %v", inode)
	}
	return node
}

func (p *Probe) addCrossConnToGraph() {
	//TODO: lock the graph
	// --> end up with a deadlock...
	for k, v := range p.crossConn {
		s := p.nodeExists(v.src)
		if s == nil {
			return
		}
		d := p.nodeExists(v.dst)
		if d == nil {
			return
		}

		if !p.g.AreLinked(s, d, nil) {
			//Add link
			p.g.NewEdge(graph.GenID(k), s, d, graph.Metadata{"nsm-crossconnect-id": k, "NetworkService": v.ns})
		} else {
			logging.GetLogger().Debugf("NSM: link for crossconnect id %v already exist in the graph", k)
		}
	}
}

func (p *Probe) OnNodeAdded(n *graph.Node) {
	if i, err := n.GetFieldInt64("Inode"); err == nil {
		logging.GetLogger().Debugf("NSM: node added with inode %v", i)
		p.addCrossConnToGraph()
	}
}

func (p *Probe) OnNodeUpdated(n *graph.Node) { return }
func (p *Probe) OnNodeDeleted(n *graph.Node) { return }
func (p *Probe) OnEdgeUpdated(e *graph.Edge) { return }
func (p *Probe) OnEdgeAdded(e *graph.Edge)   { return }
func (p *Probe) OnEdgeDeleted(e *graph.Edge) { return }

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
		g:              g,
		nsmds:          make(map[string]*grpc.ClientConn),
		remoteConnPool: make(map[string]*remoteConnectionPair),
		crossConn:      make(map[string]*crossConnInodes),
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

func (p *Probe) updateRemoteLocalConn(t cc.CrossConnectEventType, id string, payload string,
	src *remoteconn.Connection, dst *localconn.Connection) {
	dstInode, err := getLocalInode(dst)
	if err != nil {
		return
	}
	_ = dstInode
	key := src.Id
	if t != cc.CrossConnectEventType_DELETE {
		if pair, ok := p.remoteConnPool[key]; ok {
			if proto.Equal(pair.bridge, src) {
				pair.dst = dst
				// TODO: Update Graph
			} else {
				logging.GetLogger().Errorf("Different Remote Connection with id %s.", id)
				return
			}
		} else {
			p.remoteConnPool[key] = &remoteConnectionPair{
				dstId:   id,
				payload: payload,
				dst:     dst,
				bridge:  src,
			}
		}
	} else {
		if pair, ok := p.remoteConnPool[key]; ok {
			if pair.bridge == nil {
				defer delete(p.remoteConnPool, id)
				// TODO: Update Graph
			} else {
				pair.bridge = nil
			}
		} else {
			logging.GetLogger().Errorf("Unknown id to delete: %s.", id)
			return
		}
	}
}

func (p *Probe) updateLocalRemoteConn(t cc.CrossConnectEventType, id string, payload string,
	src *localconn.Connection, dst *remoteconn.Connection) {
	srcInode, err := getLocalInode(src)
	if err != nil {
		return
	}
	_ = srcInode
	key := dst.Id
	if t != cc.CrossConnectEventType_DELETE {
		if pair, ok := p.remoteConnPool[key]; ok {
			if proto.Equal(pair.bridge, dst) {
				pair.src = src
				// TODO: Update Graph
			} else {
				logging.GetLogger().Errorf("Different Remote Connection with id %s.", id)
				return
			}
		} else {
			p.remoteConnPool[key] = &remoteConnectionPair{
				srcId:   id,
				payload: payload,
				src:     src,
				bridge:  dst,
			}
		}
	} else {
		if pair, ok := p.remoteConnPool[key]; ok {
			if pair.bridge == nil {
				defer delete(p.remoteConnPool, id)
				// TODO: Update Graph
			} else {
				pair.bridge = nil
			}
		} else {
			logging.GetLogger().Errorf("Unknown id to delete: %s.", id)
			return
		}
	}
}
