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
	"net"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/golang/protobuf/ptypes/empty"
	cc "github.com/ligato/networkservicemesh/controlplane/pkg/apis/crossconnect"
	localconn "github.com/ligato/networkservicemesh/controlplane/pkg/apis/local/connection"
	"github.com/skydive-project/skydive/common"
	"github.com/skydive-project/skydive/config"
	"github.com/skydive-project/skydive/filters"
	"github.com/skydive-project/skydive/logging"
	"github.com/skydive-project/skydive/topology/graph"
	"google.golang.org/grpc"
)

// Probe ...
type Probe struct {
	g     *graph.Graph
	state int64
	conn  *grpc.ClientConn
}

func (p *Probe) run() {
	atomic.StoreInt64(&p.state, common.RunningState)

	logging.GetLogger().Debugf("NSM: running probe")

	var err error
	nsmds := config.GetStringSlice("analyzer.topology.nsm.servers")
	if len(nsmds) == 0 {
		logging.GetLogger().Errorf("NSM: no nsm server specified in config file")
		return
	}
	sa, err := common.ServiceAddressFromString(nsmds[0])
	if err != nil {
		logging.GetLogger().Errorf("NSM: error parsing nsm server address: %v", err)
	}
	p.conn, err = dial(context.Background(), "tcp", sa.String())
	if err != nil {
		logging.GetLogger().Errorf("NSM: unable to create grpc dialer, error: %+v", err)
		return
	}

	client := cc.NewMonitorCrossConnectClient(p.conn)
	//TODO: grpc is automagically trying to reconnect
	// better understand the process to handle corner cases
	stream, err := client.MonitorCrossConnects(context.Background(), &empty.Empty{})
	if err != nil {
		logging.GetLogger().Errorf("NSM: unable to connect to grpc server, error: %+v.", err)
		return
	}

	for atomic.LoadInt64(&p.state) == common.RunningState {
		//TODO: loop each nsmd servers monitoring in dedicated goroutines
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
		//time.Sleep(1 * time.Second)
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
	p.conn.Close()
}

// NewProbe ...
func NewNsmProbe(g *graph.Graph) (*Probe, error) {
	probe := &Probe{
		g:    g,
		conn: nil,
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
