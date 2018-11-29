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

	"github.com/golang/protobuf/ptypes/empty"
	cc "github.com/ligato/networkservicemesh/controlplane/pkg/apis/crossconnect"
	localconn "github.com/ligato/networkservicemesh/controlplane/pkg/apis/local/connection"
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

// Probe ...
type Probe struct {
	g     *graph.Graph
	state int64
	nsmds map[string]*grpc.ClientConn
}

func (p *Probe) run() {
	atomic.StoreInt64(&p.state, common.RunningState)

	logging.GetLogger().Debugf("NSM: running probe")

	logging.GetLogger().Debugf("NSM: getting k8s config")
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
		logging.GetLogger().Errorf("Unable to find NSMs", err)
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
			p.updateGraph(event.Type, cconn)
		}
	}
}

//TODO: consider moving this function to
// https://github.com/ligato/networkservicemesh/blob/master/controlplane/pkg/apis/local/connection/mechanism_helpers.go
func getLocalInode(conn *localconn.Connection) (int64, error) {
	inode_str := conn.Mechanism.Parameters["inode"]
	inode, err := strconv.ParseInt(inode_str, 10, 64)
	if err != nil {
		logging.GetLogger().Errorf("NSM: error converting inode %s to int64", inode_str)
		return 0, err
	}
	return inode, nil
}

func (p *Probe) updateGraph(t cc.CrossConnectEventType, cconn *cc.CrossConnect) {
	p.g.Lock()
	defer p.g.Unlock()
	//add the crossconnect to the graph if elements exists
	src := cconn.GetLocalSource()
	if src == nil {
		return
	}
	src_inode, err := getLocalInode(src)
	if err != nil {
		return
	}
	dst := cconn.GetLocalDestination()
	if dst == nil {
		return
	}
	dst_inode, err := getLocalInode(dst)
	if err != nil {
		return
	}
	srcfilter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", src_inode))
	src_node := p.g.LookupFirstNode(srcfilter)
	if src_node == nil {
		logging.GetLogger().Errorf("src inode not found")
		return
	}
	dstfilter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", dst_inode))
	dst_node := p.g.LookupFirstNode(dstfilter)
	if dst_node == nil {
		return
	}
	if t != cc.CrossConnectEventType_DELETE {
		p.g.NewEdge(graph.GenID(cconn.Id), src_node, dst_node, graph.Metadata{"Id": cconn.Id, "Payload": cconn.Payload, "NetworkService": dst.NetworkService})

	} else {
		p.g.Unlink(src_node, dst_node)
	}
	return
}

// Start ...
func (p *Probe) Start() {
	go p.run()
}

// Stop ....
func (p *Probe) Stop() {
	atomic.CompareAndSwapInt64(&p.state, common.RunningState, common.StoppingState)
	for _, conn := range p.nsmds {
		conn.Close()
	}
}

// NewProbe ...
func NewNsmProbe(g *graph.Graph) (*Probe, error) {
	probe := &Probe{
		g: g,
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
