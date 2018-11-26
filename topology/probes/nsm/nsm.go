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

	client := cc.NewMonitorCrossConnectClient(p.conn)
	stream, err := client.MonitorCrossConnects(context.Background(), &empty.Empty{})
	if err != nil {
		logging.GetLogger().Warningf("Error: %+v.", err)
		return
	}

	getLocalInode := func(conn *localconn.Connection) (int64, error) {
		inode_str := conn.Mechanism.Parameters["inode"]
		inode, err := strconv.ParseInt(inode_str, 10, 64)
		if err != nil {
			logging.GetLogger().Errorf("error converting inode %s to int64", inode_str)
			return 0, err
		}
		return inode, nil
	}

	for atomic.LoadInt64(&p.state) == common.RunningState {
		event, err := stream.Recv()
		if err != nil {
			logging.GetLogger().Errorf("Error: %+v.", err)
			return
		}

		for _, cconn := range event.CrossConnects {
			//add the crossconnect to the graph if elements exists
			src := cconn.GetLocalSource()
			if src == nil {
				continue
			}
			src_inode, err := getLocalInode(src)
			if err != nil {
				continue
			}
			dst := cconn.GetLocalDestination()
			if dst == nil {
				continue
			}
			dst_inode, err := getLocalInode(dst)
			if err != nil {
				continue
			}
			p.updateGraph(src_inode, dst_inode, event.Type, cconn)
		}
		time.Sleep(1 * time.Second)
	}
}

func (p *Probe) updateGraph(src int64, dst int64, t cc.CrossConnectEventType, cconn *cc.CrossConnect) {
	p.g.Lock()
	defer p.g.Unlock()
	srcfilter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", src))
	src_node := p.g.LookupFirstNode(srcfilter)
	if src_node == nil {
		logging.GetLogger().Errorf("src inode not found")
		return
	}
	dstfilter := graph.NewElementFilter(filters.NewTermInt64Filter("Inode", dst))
	dst_node := p.g.LookupFirstNode(dstfilter)
	if dst_node == nil {
		return
	}
	if t != cc.CrossConnectEventType_DELETE {
		p.g.NewEdge(graph.GenID(cconn.Id), src_node, dst_node, graph.Metadata{"Id": cconn.Id, "Payload": cconn.Payload})

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
