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
	"sync/atomic"
	"time"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/ligato/networkservicemesh/controlplane/pkg/apis/crossconnect"
	"github.com/skydive-project/skydive/common"
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

	logging.GetLogger().Debugf("NSM probe process...")

	var err error
	for {
		p.conn, err = dial(context.Background(), "tcp", "127.0.0.1:5007")
		if err != nil {
			logging.GetLogger().Errorf("NSM: failure to communicate with the socket %s with error: %+v", "127.0.0.1:5007", err)
			time.Sleep(1 * time.Second)
			continue
		}
		break
	}

	client := crossconnect.NewMonitorCrossConnectClient(p.conn)

	// Looping indefinetly or until grpc returns an error indicating the other end closed connection.
	go monitorNSM(client)

	for atomic.LoadInt64(&p.state) == common.RunningState {
		p.g.Lock()

		// creates two nodes
		n1 := p.g.NewNode(graph.GenID("NODE1"), graph.Metadata{"Name": "node1", "Type": "vm"})
		n2 := p.g.NewNode(graph.GenID("NODE2"), graph.Metadata{"Name": "node2", "Type": "vm"})

		// link them
		p.g.NewEdge(graph.GenID("NODE1/NODE2"), n1, n2, graph.Metadata{"Type": "l2vpn"})

		p.g.Unlock()

		time.Sleep(1 * time.Second)
	}
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

func monitorNSM(client crossconnect.MonitorCrossConnectClient) {
	stream, err := client.MonitorCrossConnects(context.Background(), &empty.Empty{})
	if err != nil {
		logging.GetLogger().Warningf("Error: %+v.", err)
		return
	}
	result := []*crossconnect.CrossConnectEvent{}
	for {
		event, err := stream.Recv()
		if err != nil {
			logging.GetLogger().Errorf("Error: %+v.", err)
			return
		}
		logging.GetLogger().Infof("Events: %+v", event)
		result = append(result, event)
	}

	//wait for a chan to close conn?
}
