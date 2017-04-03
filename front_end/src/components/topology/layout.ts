import { Message, Graph, GNode, Edge, Group } from './graph';
import { TopologyComponent } from './topology';
import * as lscache from 'lscache';
import { websocket, store } from '../../app'
import * as d3 from 'd3';

const hostImg = 'statics/img/host.png';
const switchImg = 'statics/img/switch.png';
const portImg = 'statics/img/port.png';
const intfImg = 'statics/img/intf.png';
const vethImg = 'statics/img/veth.png';
const nsImg = 'statics/img/ns.png';
const bridgeImg = 'statics/img/bridge.png';
const dockerImg = 'statics/img/docker.png';
const neutronImg = 'statics/img/openstack.png';
const minusImg = 'statics/img/minus-outline-16.png';
const plusImg = 'statics/img/plus-16.png';
const probeIndicatorImg = 'statics/img/media-record.png';
const pinIndicatorImg = 'statics/img/pin.png';

interface Link extends d3.layout.force.Link<GNode> {
    source: GNode;
    target: GNode;
    edge: Edge;
}

interface DeferredAction {
    fn: (...args: any[]) => void;
    params: any[]
}

export class TopologyLayout {
    vm: TopologyComponent;
    graph: Graph;

    deferredActions: DeferredAction[];
    selector: string;
    elements: { [key: string]: (GNode | Edge) };
    groups: { [key: string]: Group };
    synced: boolean;
    lscachetimeout: number;
    keeplayout: boolean;
    alerts: { [key: string]: string };

    redrawTimeout: number;

    nodes: GNode[];
    links: Link[];

    width: number;
    height: number;
    zoom: d3.behavior.Zoom<{}>;

    svg: d3.Selection<{}>;
    view: d3.Selection<{}>;
    groupsG: d3.Selection<{}>;
    link: d3.Selection<Link>;
    node: d3.Selection<GNode>;
    group: d3.Selection<Group>;


    force: d3.layout.Force<Link, GNode>;
    drag: d3.behavior.Drag<GNode>;

    constructor(vm, selector) {
        var self = this;
        this.vm = vm;
        this.graph = new Graph();
        this.selector = selector;
        this.elements = {};
        this.groups = {};
        this.synced = false;
        this.lscachetimeout = 60 * 24 * 7;
        this.keeplayout = false;
        this.alerts = {};

        window.setInterval(function () {
            // keep track of position once one drag occured
            if (self.keeplayout) {
                for (var i in self.nodes) {
                    var node = self.nodes[i];
                    lscache.set(self.nodes[i].Metadata.TID, { x: node.x, y: node.y, fixed: node.fixed }, self.lscachetimeout);
                }
            }
        }, 30000);

        websocket.addConnectHandler(this.SyncRequest.bind(this));
        websocket.addDisconnectHandler(this.Invalidate.bind(this));
        websocket.addMsgHandler('Graph', this.ProcessGraphMessage.bind(this));
        websocket.addMsgHandler('Alert', this.ProcessAlertMessage.bind(this));

        this.width = $(selector).width() - 8;
        this.height = $(selector).height();

        this.svg = d3.select(selector).append("svg")
            .attr("width", this.width)
            .attr("height", this.height)
            .attr("y", 60)
            .attr('viewBox', -this.width / 2 + ' ' + -this.height / 2 + ' ' + this.width * 2 + ' ' + this.height * 2)
            .attr('preserveAspectRatio', 'xMidYMid meet')

        var _this = this;

        this.zoom = d3.behavior.zoom()
            .on("zoom", function () { _this.Rescale(); });

        this.force = d3.layout.force<Link, GNode>()
            .size([this.width, this.height])
            .charge(-400)
            .gravity(0.02)
            .linkStrength(0.5)
            .friction(0.8)
            .linkDistance(function (d, i) {
                return _this.LinkDistance(d, i);
            })
            .on("tick", function (e) {
                _this.Tick(e);
            });

        this.view = this.svg.append('g');

        this.svg.call(this.zoom)
            .on("dblclick.zoom", null);

        this.drag = this.force.stop().drag()
            .on("dragstart", function (d) {
                _this.keeplayout = true;
                (d3.event as d3.DragEvent).sourceEvent.stopPropagation();
            });

        this.groupsG = this.view.append("g")
            .attr("class", "groups")
            .on("click", function () {
                // TODO: no interface provides a preventDefault
                (d3.event as any).preventDefault();
            });

        this.deferredActions = [];
        this.links = this.force.links();
        this.nodes = this.force.nodes();

        var linksG = this.view.append("g").attr("class", "links");
        this.link = linksG.selectAll<Link>(".link");

        var nodesG = this.view.append("g").attr("class", "nodes");
        this.node = nodesG.selectAll<GNode>(".node");

        // un-comment to debug relationships
        /*this.svg.append("svg:defs").selectAll("marker")
          .data(["end"])      // Different link/path types can be defined here
          .enter().append("svg:marker")    // This section adds in the arrows
          .attr("id", String)
          .attr("viewBox", "0 -5 10 10")
          .attr("refX", 25)
          .attr("refY", -1.5)
          .attr("markerWidth", 6)
          .attr("markerHeight", 6)
          .attr("orient", "auto")
          .append("svg:path")
          .attr("d", "M0,-5L10,0L0,5");*/
    };

    LinkDistance(d: Link, i: number) {
        var distance = 60;

        if (d.source.Group == d.target.Group) {
            if (d.source.Metadata.Type == "host") {
                for (var property in d.source.Edges)
                    distance += 2;
                return distance;
            }
        }

        // local to fabric
        if ((d.source.Metadata.Probe == "fabric" && !d.target.Metadata.Probe) ||
            (!d.source.Metadata.Probe && d.target.Metadata.Probe == "fabric")) {
            return distance + 100;
        }
        return 80;
    };

    InitFromSyncMessage(msg: Message) {
        if (msg.Status != 200) {
            this.vm.$error({ message: 'Unable to init topology' });
            return;
        }

        this.graph.InitFromSyncMessage(msg);

        for (var ID in this.graph.Nodes) {
            this.AddNode(this.graph.Nodes[ID]);
        }

        for (var ID in this.graph.Edges)
            this.AddEdge(this.graph.Edges[ID]);

        if (store.state.currentNode) {
            var id = store.state.currentNode.ID;
            if (id in this.elements) {
                store.commit('selected', this.elements[id]);
            } else {
                store.commit('unselected');
            }
        }

    };

    Invalidate() {
        this.synced = false;
    };

    Clear() {
        var ID;

        for (ID in this.graph.Edges)
            this.DelEdge(this.graph.Edges[ID]);

        for (ID in this.graph.Nodes)
            this.DelNode(this.graph.Nodes[ID]);

        for (ID in this.graph.Edges)
            this.graph.DelEdge(this.graph.Edges[ID]);

        for (ID in this.graph.Nodes)
            this.graph.DelNode(this.graph.Nodes[ID]);
    };

    Rescale() {
        var trans = (d3.event as d3.ZoomEvent).translate;
        var scale = (d3.event as d3.ZoomEvent).scale;

        this.view.attr("transform", "translate(" + trans + ")" + " scale(" + scale + ")");
    };

    SetPosition(x, y) {
        this.view.attr("x", x).attr("y", y);
    };

    SetNodeClass(ID, clazz, active) {
        d3.select("#node-" + ID).classed(clazz, active);
    };

    Hash(str) {
        var chars = str.split('');

        var hash = 2342;
        for (var i in chars) {
            var c = chars[i].charCodeAt(0);
            hash = ((c << 5) + hash) + c;
        }

        return hash;
    };

    AddNode(node) {
        if (node.ID in this.elements)
            return;

        this.elements[node.ID] = node;

        // get postion for cache otherwise distribute node on a circle depending on the host
        var data = lscache.get(node.Metadata.TID);
        if (data) {
            node.x = data.x;
            node.y = data.y;
            node.fixed = data.fixed;
        } else {
            var place = this.Hash(node.Host) % 100;
            node.x = Math.cos(place / 100 * 2 * Math.PI) * 500 + this.width / 2 + Math.random();
            node.y = Math.sin(place / 100 * 2 * Math.PI) * 500 + this.height / 2 + Math.random();
        }

        this.nodes.push(node);

        this.Redraw();
    };

    UpdateNode = function (node, metadata) {
        node.Metadata = metadata;
    };

    DelNode(node) {
        if (this.synced && store.state.currentNode &&
            store.state.currentNode.ID == node.ID) {
            store.commit('unselected');
        }

        if (!(node.ID in this.elements))
            return;

        for (var i=0; i < this.nodes.length; i++) {
            if (this.nodes[i].ID == node.ID) {
                this.nodes.splice(i, 1);
                break;
            }
        }
        delete this.elements[node.ID];

        this.Redraw();
    };

    AddEdge(edge) {
        if (edge.ID in this.elements)
            return;

        this.elements[edge.ID] = edge;

        // ignore layer 3 for now
        if (edge.Metadata.RelationType == "layer3")
            return;

        // specific to link to host
        var i, e, nparents;
        if (edge.Parent.Metadata.Type == "host") {
            if (edge.Child.Metadata.Type == "ovsbridge" ||
                edge.Child.Metadata.Type == "netns")
                return;

            if (edge.Child.Metadata.Type == "bridge" && this.graph.GetNeighbors(edge.Child).length > 1)
                return;

            nparents = this.graph.GetParents(edge.Child).length;
            if (nparents > 2 || (nparents > 1 && this.graph.GetChildren(edge.Child).length !== 0))
                return;
        } else {
            var nodes = [edge.Parent, edge.Child];
            for (var n in nodes) {
                var node = nodes[n];
                for (i in node.Edges) {
                    e = node.Edges[i];
                    if (e.Parent.Metadata.Type == "host") {

                        if (node.Metadata.Type == "bridge" && this.graph.GetNeighbors(node).length > 1) {
                            this.DelEdge(e);
                            break;
                        }

                        nparents = this.graph.GetParents(node).length;
                        if (nparents > 2 || (nparents > 1 && this.graph.GetChildren(node).length !== 0)) {
                            this.DelEdge(e);
                            break;
                        }
                    }
                }
            }
        }

        this.links.push({ source: edge.Parent, target: edge.Child, edge: edge });

        this.Redraw();
    };

    DelEdge(edge) {
        if (!(edge.ID in this.elements))
            return;

        for (var i = 0; i < this.links.length; i++) {
            if (this.links[i].source.ID == edge.Parent.ID &&
                this.links[i].target.ID == edge.Child.ID) {

                var nodes = [edge.Parent, edge.Child];
                for (var n in nodes) {
                    var node = nodes[n];

                    if (node.Metadata.Type == "bridge" && this.graph.GetNeighbors(node).length < 2) {
                        for (var e in node.Edges) {
                            if (node.Edges[e].Parent.Metadata.Type == "host" || node.Edges[e].Child.Metadata.Type == "host") {
                                this.AddEdge(node.Edges[e]);
                            }
                        }
                    }
                }
                this.links.splice(i, 1);
            }
        }
        delete this.elements[edge.ID];

        this.Redraw();
    };

    Tick(e) {
        this.link.attr("d", this.linkArc);

        this.node.attr("cx", function (d) { return d.x; })
            .attr("cy", function (d) { return d.y; });

        this.node.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });

        var _this = this;
        if (this.group.length > 0)
            this.group.data(this.Groups()).attr("d", function (d) {
                return _this.DrawCluster(d);
            });
    };

    linkArc(d: Link) {
        var dx = d.target.x - d.source.x,
            dy = d.target.y - d.source.y,
            dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
        return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
    };

    CircleSize = function (d: GNode) {
        var size;
        switch (d.Metadata.Type) {
            case "host":
                size = 22;
                break;
            case "port":
            case "ovsport":
                size = 18;
                break;
            case "switch":
            case "ovsbridge":
                size = 20;
                break;
            default:
                size = 16;
                break;
        }

        if (store.state.currentNode && store.state.currentNode.ID === d.ID) {
            size += 3;
        }

        return size;
    };

    GroupClass(d: Group) {
        return "group " + d.Type;
    };

    NodeClass(d: GNode) {
        var clazz = "node " + d.Metadata.Type;

        if (d.ID in this.alerts)
            clazz += " alert";

        if (d.Metadata.State == "DOWN")
            clazz += " down";

        if (d.Highlighted)
            clazz = "highlighted " + clazz;

        if (store.state.currentNode && store.state.currentNode.ID === d.ID)
            clazz = "active " + clazz;

        return clazz;
    };

    EdgeClass(d: Link) {
        if (d.edge.Metadata.Type == "fabric") {
            if ((d.edge.Parent.Metadata.Probe == "fabric" && !d.edge.Child.Metadata.Probe) ||
                (!d.edge.Parent.Metadata.Probe && d.edge.Child.Metadata.Probe == "fabric")) {
                return "link local2fabric";
            }
        }

        return "link " + (d.edge.Metadata.Type || '') + " " + (d.edge.Metadata.RelationType || '');
    };

    CircleOpacity(d: GNode) {
        if (d.Metadata.Type == "netns" && d.Metadata.Manager === null)
            return 0.0;
        return 1.0;
    };

    EdgeOpacity(d: Link) {
        if (d.source.Metadata.Type == "netns" || d.target.Metadata.Type == "netns")
            return 0.0;
        return 1.0;
    };

    NodeManagerPicto(d: GNode) {
        switch (d.Metadata.Manager) {
            case "docker":
                return dockerImg;
            case "neutron":
                return neutronImg;
        }
    };

    NodeManagerStyle(d: GNode) {
        switch (d.Metadata.Manager) {
            case "docker":
                return "";
            case "neutron":
                return "";
        }

        return "visibility: hidden";
    };

    NodePicto(d: GNode) {
        switch (d.Metadata.Type) {
            case "host":
                return hostImg;
            case "port":
            case "ovsport":
                return portImg;
            case "bridge":
                return bridgeImg;
            case "switch":
            case "ovsbridge":
                return switchImg;
            case "netns":
                return nsImg;
            case "veth":
                return vethImg;
            case "bond":
                return portImg;
            case "container":
                return dockerImg;
            default:
                return intfImg;
        }
    };

    NodeProbeStatePicto(d: GNode) {
        if (d.IsCaptureOn())
            return probeIndicatorImg;
        return "";
    };

    NodePinStatePicto(d: GNode) {
        if (d.fixed)
            return pinIndicatorImg;
        return "";
    };

    NodeStatePicto(d: GNode) {
        if (d.Metadata.Type !== "netns" && d.Metadata.Type !== "host")
            return "";

        if (d.Collapsed)
            return plusImg;
        return minusImg;
    };

    // return the parent for a give node as a node can have mutliple parent
    // return the best one. For ex an ovsport is not considered as a parent,
    // host node will be a better candiate.
    ParentNodeForGroup(node: GNode) {
        var parent;
        for (var i in node.Edges) {
            var edge = node.Edges[i];
            if (edge.Parent == node)
                continue;

            if (edge.Parent.Metadata.Probe == "fabric")
                continue;

            switch (edge.Parent.Metadata.Type) {
                case "ovsport":
                    if (node.Metadata.IfIndex)
                        break;
                    return edge.Parent;
                case "ovsbridge":
                case "netns":
                    return edge.Parent;
                default:
                    parent = edge.Parent;
            }
        }

        return parent;
    };

    AddNodeToGroup(ID, type, node, groups) {
        var group = groups[ID] || (groups[ID] = new Group(ID, type));
        if (node.ID in group.Nodes)
            return;

        group.Nodes[node.ID] = node;
        if (node.Group === '')
            node.Group = ID;

        if (isNaN(parseFloat(node.x)))
            return;

        if (!node.Visible)
            return;

        // padding around group path
        var pad = 24;
        if (group.Type == "host" || group.Type == "vm")
            pad = 48;
        if (group.Type == "fabric")
            pad = 60;

        group.Hulls.push([node.x - pad, node.y - pad]);
        group.Hulls.push([node.x - pad, node.y + pad]);
        group.Hulls.push([node.x + pad, node.y - pad]);
        group.Hulls.push([node.x + pad, node.y + pad]);
    };

    // add node to parent group until parent is of type host
    // this means a node can be in multiple group
    addNodeToParentGroup(parent, node, groups) {
        if (parent) {
            var groupID = parent.ID;

            // parent group exist so add node to it
            if (groupID in groups)
                this.AddNodeToGroup(groupID, '', node, groups);

            if (parent.Metadata.Type != "host") {
                parent = this.ParentNodeForGroup(parent);
                this.addNodeToParentGroup(parent, node, groups);
            }
        }
    };

    UpdateGroups() {
        var node;
        var i;

        this.groups = {};

        for (i in this.graph.Nodes) {
            node = this.graph.Nodes[i];

            // present in graph but not in d3
            if (!(node.ID in this.elements))
                continue;

            // reset node group
            node.Group = '';

            var groupID;
            if (node.Metadata.Probe == "fabric") {
                if ("Group" in node.Metadata && node.Metadata.Group !== "") {
                    groupID = node.Metadata.Group;
                } else {
                    groupID = "fabric";
                }
                this.AddNodeToGroup(groupID, "fabric", node, this.groups);
            } else {
                // these node a group holder
                switch (node.Metadata.Type) {
                    case "host":
                        if ("InstanceID" in node.Metadata) {
                            this.AddNodeToGroup(node.ID, "vm", node, this.groups);
                            break;
                        }
                    case "ovsbridge":
                    case "netns":
                        this.AddNodeToGroup(node.ID, node.Metadata.Type, node, this.groups);
                }
            }
        }

        // place nodes in groups
        for (i in this.graph.Nodes) {
            node = this.graph.Nodes[i];

            if (!(node.ID in this.elements))
                continue;

            var parent = this.ParentNodeForGroup(node);
            this.addNodeToParentGroup(parent, node, this.groups);
        }
    };

    Groups() {
        var groupArray = [];

        this.UpdateGroups();
        for (var ID in this.groups) {
            groupArray.push({ Group: ID, Type: this.groups[ID].Type, path: d3.geom.hull(this.groups[ID].Hulls) });
        }

        return groupArray;
    };

    DrawCluster(d) {
        var curve = d3.svg.line()
            .interpolate("cardinal-closed")
            .tension(0.90);

        return curve(d.path);
    };

    GetNodeText(d) {
        var name = this.graph.GetNode(d.ID).Metadata.Name;
        if (name.length > 10)
            name = name.substr(0, 8) + ".";

        return name;
    };

    CollapseNetNS(node) {
        for (var i in node.Edges) {
            var edge = node.Edges[i];

            if (edge.Child == node)
                continue;

            if (Object.keys(edge.Child.Edges).length == 1) {
                edge.Child.Visible = edge.Child.Visible ? false : true;
                edge.Visible = edge.Visible ? false : true;

                node.Collapsed = edge.Child.Visible ? false : true;
            }
        }
    };

    CollapseHost(hostNode) {
        var fabricNode;
        var isCollapsed = hostNode.Collapsed ? false : true;

        // All nodes in the group
        for (var i in this.nodes) {
            var node = this.nodes[i];

            if (node.Host != hostNode.Host)
                continue;

            if (node == hostNode)
                continue;

            // All edges (connected to all nodes in the group)
            for (var j in node.Edges) {
                var edge = node.Edges[j];

                if (edge.Metadata.Type == "fabric") {
                    fabricNode = node;
                    continue;
                }

                if ((edge.Parent == hostNode) || (edge.Child == hostNode)) {
                    var child = edge.Child
                    var found = false;
                    for (var n in child.Edges) {
                        var nEdge = edge.Child.Edges[n]
                        if (nEdge.Metadata.Type == "fabric")
                            found = true;
                        continue;
                    }

                    if (found)
                        continue;
                }

                edge.Visible = isCollapsed ? false : true;
            }

            if (node == fabricNode)
                continue;

            node.Visible = isCollapsed ? false : true;
        }

        hostNode.Collapsed = isCollapsed;
    };

    CollapseNode(d) {
        if ((d3.event as any).defaultPrevented)
            return;

        switch (d.Metadata.Type) {
            case "netns":
                this.CollapseNetNS(d);
                break;
            case "host":
                this.CollapseHost(d);
                break;
            default:
                return;
        }

        this.Redraw();
    };

    Redraw() {
        var self = this;

        if (typeof this.redrawTimeout == "undefined")
            this.redrawTimeout = window.setTimeout(function () {
                for (var i in self.deferredActions) {
                    var action = self.deferredActions[i];
                    action.fn.apply(self, action.params);
                }
                self.deferredActions = [];

                self.redraw();

                clearTimeout(self.redrawTimeout);
                self.redrawTimeout = undefined;
            }, 100);
    };

    redraw() {
        var _this = this;
        var linkEnter = this.link.data(this.links, function (d) { return d.source.ID + "-" + d.target.ID; });
        this.link = linkEnter;
        linkEnter.exit().remove();
        linkEnter.enter().append("path")
            .attr("marker-end", "url(#end)")
            .style("opacity", function (d) {
                return _this.EdgeOpacity(d);
            })
            .attr("class", function (d) {
                return _this.EdgeClass(d);
            });

        var nodeEnter = this.node.data(this.nodes, function (d) { return d.ID; })
            .attr("class", function (d) {
                return _this.NodeClass(d);
            })
            .style("display", function (d) {
                return !d.Visible ? "none" : "block";
            });
        this.node = nodeEnter;
        nodeEnter.exit().remove();

        nodeEnter.enter().append("g")
            .attr("id", function (d) { return "node-" + d.ID; })
            .attr("class", function (d) {
                return _this.NodeClass(d);
            })
            .on("click", function (d) {
                if ((d3.event as any).shiftKey) {
                    if (d.fixed)
                        d.fixed = false;
                    else
                        d.fixed = true;
                    _this.redraw();
                    return;
                }
                store.commit('selected', d);
            })
            .on("dblclick", function (d) {
                return _this.CollapseNode(d);
            })
            .call(this.drag);

        nodeEnter.append("circle")
            .attr("r", this.CircleSize)
            .attr("class", "circle")
            .style("opacity", function (d) {
                return _this.CircleOpacity(d);
            });

        nodeEnter.append("image")
            .attr("class", "picto")
            .attr("xlink:href", function (d) {
                return _this.NodePicto(d);
            })
            .attr("x", -10)
            .attr("y", -10)
            .attr("width", 20)
            .attr("height", 20);

        nodeEnter.append("image")
            .attr("class", "probe")
            .attr("x", -25)
            .attr("y", 5)
            .attr("width", 20)
            .attr("height", 20);

        nodeEnter.append("image")
            .attr("class", "pin")
            .attr("x", 10)
            .attr("y", -23)
            .attr("width", 16)
            .attr("height", 16);

        nodeEnter.append("image")
            .attr("class", "state")
            .attr("x", -20)
            .attr("y", -20)
            .attr("width", 12)
            .attr("height", 12);

        nodeEnter.append("circle")
            .attr("class", "manager")
            .attr("r", 12)
            .attr("cx", 14)
            .attr("cy", 16);

        nodeEnter.append("image")
            .attr("class", "manager")
            .attr("x", 4)
            .attr("y", 6)
            .attr("width", 20)
            .attr("height", 20);

        nodeEnter.append("text")
            .attr("dx", 22)
            .attr("dy", ".35em")
            .text(function (d) {
                return _this.GetNodeText(d);
            });

        // bounding boxes for groups
        this.groupsG.selectAll("path.group").remove();
        this.group = this.groupsG.selectAll("path.group");
        this.group.data<Group>(this.Groups()).enter().append("path")
            .attr("class", function (d) {
                return _this.GroupClass(d);
            })
            .attr("id", function (d) {
                return d.ID; // Was group - does not exists
            })
            .attr("d", function (d) {
                return _this.DrawCluster(d);
            });

        this.node.select('text')
            .text(function (d) {
                return _this.GetNodeText(d);
            });

        this.node.select('image.state').attr("xlink:href", function (d) {
            return _this.NodeStatePicto(d);
        });

        this.node.select('image.probe').attr("xlink:href", function (d) {
            return _this.NodeProbeStatePicto(d);
        });

        this.node.select('image.pin').attr("xlink:href", function (d) {
            return _this.NodePinStatePicto(d);
        });

        this.node.select('image.manager').attr("xlink:href", function (d) {
            return _this.NodeManagerPicto(d);
        });

        this.node.select('circle.manager').attr("style", function (d) {
            return _this.NodeManagerStyle(d);
        });

        this.force.start();
    };

    ProcessGraphMessage(msg: Message) {
        if (msg.Type != "SyncReply" && (!this.vm.live || !this.synced)) {
            console.log("Skipping message " + msg.Type);
            return;
        }

        var node;
        var edge;
        switch (msg.Type) {
            case "SyncReply":
                this.synced = false;
                this.Clear();
                this.InitFromSyncMessage(msg);
                this.synced = true;
                break;

            case "NodeUpdated":
                node = this.graph.GetNode(msg.Obj.ID);
                var redrawOn = ['Capture/ID', 'Status'],
                    redraw = redrawOn.reduce(function (acc, key) {
                        if (msg.Obj.Metadata[key] !== node.Metadata[key]) {
                            acc = true;
                        }
                        return acc;
                    }, false);

                if (redraw) {
                    this.deferredActions.push({ fn: this.UpdateNode, params: [node, msg.Obj.Metadata] });
                    this.Redraw();
                } else {
                    this.UpdateNode(node, msg.Obj.Metadata);
                }
                break;

            case "NodeAdded":
                node = this.graph.NewNode(msg.Obj.ID, msg.Obj.Host);
                if ("Metadata" in msg.Obj)
                    node.Metadata = msg.Obj.Metadata;

                this.deferredActions.push({ fn: this.AddNode, params: [node] });
                this.Redraw();
                break;

            case "NodeDeleted":
                node = this.graph.GetNode(msg.Obj.ID);
                if (typeof node == "undefined")
                    return;

                this.graph.DelNode(node);
                this.deferredActions.push({ fn: this.DelNode, params: [node] });
                this.Redraw();
                break;

            case "EdgeUpdated":
                edge = this.graph.GetEdge(msg.Obj.ID);
                edge.Metadata = msg.Obj.Metadata;

                this.Redraw();
                break;

            case "EdgeAdded":
                var parent = this.graph.GetNode(msg.Obj.Parent);
                var child = this.graph.GetNode(msg.Obj.Child);

                edge = this.graph.NewEdge(msg.Obj.ID, parent, child, msg.Obj.Host);
                if ("Metadata" in msg.Obj)
                    edge.Metadata = msg.Obj.Metadata;

                this.deferredActions.push({ fn: this.AddEdge, params: [edge] });
                this.Redraw();
                break;

            case "EdgeDeleted":
                edge = this.graph.GetEdge(msg.Obj.ID);
                if (typeof edge == "undefined")
                    break;

                this.graph.DelEdge(edge);
                this.deferredActions.push({ fn: this.DelEdge, params: [edge] });
                this.Redraw();
                break;
        }
    };

    ProcessAlertMessage(msg: Message) {
        var _this = this;

        var ID = msg.Obj.ReasonData.ID;
        this.alerts[ID] = msg.Obj;
        this.Redraw();

        window.setTimeout(function () { delete this.alerts[ID]; _this.Redraw(); }, 1000);
    };

    SyncRequest(t) {
        if (t && t === store.state.time) {
            return;
        }
        var obj: { Time?: number } = {};
        if (t) {
            obj.Time = t;
            store.commit('time', t);
        } else {
            store.commit('time', 0);
        }
        var msg = { Namespace: "Graph", Type: "SyncRequest", Obj: obj };
        websocket.send(msg);
    }
}
