/* jshint multistr: true */
import Vue from 'vue';
import { Component, Watch } from 'vue-property-decorator';
import { ApiMixinContract, apiMixin } from '../../api';
import { NotificationMixinContract, notificationMixin, NotifOptions } from '../notifications/notifications';
import * as d3 from 'd3';
import { debounce } from '../../utils';
import { TopologyLayout } from './layout';
import * as $ from 'jquery';


@Component({
  template: require('./topology.html'),
  mixins: [apiMixin, notificationMixin]
})
export class TopologyComponent extends Vue implements NotificationMixinContract {

  $notify: (options: NotifOptions) => void;
  $error: (options: NotifOptions) => void;
  $success: (options: NotifOptions) => void;

  name = 'topology';
  time: number;
  timeRange: number[];
  collapsed: boolean;
  layout: TopologyLayout;
  timeId: number;
  syncTopo: (t?: number) => void;
  unwatch: () => void;

  data() {
    return {
      time: 0,
      timeRange: [-120, 0],
      collapsed: false,
    };
  }

  mounted() {
    let self = this;
    // run d3 layout
    this.layout = new TopologyLayout(this, '.topology-d3');

    this.syncTopo = debounce(this.layout.SyncRequest.bind(this.layout), 300);

    $(this.$el).find('.content').resizable({
      handles: 'e',
      minWidth: 300,
      resize: function (this: JQuery, event: Event, ui: JQueryUI.ResizableUIParams) {
        let x = ui.element.outerWidth();
        let y = ui.element.outerHeight();
        let ele = ui.element;
        let factor = $(this).parent().width() - x;
        let f2 = $(this).parent().width() * 0.02999;
        // TypeScript is a little lost. We get a pseudo array, so idx is a number.
        $.each<JQuery>(ele.siblings() as any, function (idx: number, item) {
          ele.siblings().eq(idx).css('height', y + 'px');
          ele.siblings().eq(idx).width((factor - f2) + 'px');
        });
      }
    });

    // trigered when some component wants to highlight some nodes
    this.$store.subscribe<{ type: string, payload: any }>(function (mutation) {
      if (mutation.type === 'highlight')
        self.layout.SetNodeClass(mutation.payload, 'highlighted', true);
      else if (mutation.type === 'unhighlight')
        self.layout.SetNodeClass(mutation.payload, 'highlighted', false);
    });

    // trigered when a node is selected
    // It seems that vue typed api is incorrect type should be () => void instead of void.
    this.unwatch = (this.$store.watch(
      function () {
        return self.$store.state.currentNode;
      },
      function (newNode, oldNode) {
        if (oldNode) {
          let old = d3.select('#node-' + oldNode.ID);
          old.classed('active', false);
          old.select('circle').attr('r', parseInt(old.select('circle').attr('r')) - 3);
        }
        if (newNode) {
          let current = d3.select('#node-' + newNode.ID);
          current.classed('active', true);
          current.select('circle').attr('r', parseInt(current.select('circle').attr('r')) + 3);
        }
      }
    ) as any);
  }

  beforeDestroy() {
    this.$store.commit('unselected');
    this.unwatch();
  }

<<<<<<< HEAD
};

var Edge = function(ID) {
  this.ID = ID;
  this.Host = '';
  this.Parent = '';
  this.Child = '';
  this.Metadata = {};
  this.Visible = true;
};

var Graph = function(ID) {
  this.Nodes = {};
  this.Edges = {};
  this.Groups = {};
};

Graph.prototype.NewNode = function(ID, host) {
  var node = new Node(ID);
  node.Graph = this;
  node.Host = host;

  this.Nodes[ID] = node;

  return node;
};

Graph.prototype.GetNode = function(ID) {
  return this.Nodes[ID];
};

Graph.prototype.GetNeighbors = function(node) {
  var neighbors = [];

  for (var i in node.Edges) {
    neighbors.push(node.Edges[i]);
  }

  return neighbors;
};

Graph.prototype.GetChildren = function(node) {
  var children = [];

  for (var i in node.Edges) {
    var e = node.Edges[i];
    if (e.Parent == node)
      children.push(e.Child);
  }

  return children;
};

Graph.prototype.GetParents = function(node) {
  var parents = [];

  for (var i in node.Edges) {
    var e = node.Edges[i];
    if (e.Child == node)
      parents.push(e.Child);
  }

  return parents;
};

Graph.prototype.GetEdge = function(ID) {
  return this.Edges[ID];
};

Graph.prototype.NewEdge = function(ID, parent, child, host) {
  var edge = new Edge(ID);
  edge.Parent = parent;
  edge.Child = child;
  edge.Graph = this;
  edge.Host = host;

  this.Edges[ID] = edge;

  parent.Edges[ID] = edge;
  child.Edges[ID] = edge;

  return edge;
};

Graph.prototype.DelNode = function(node) {
  for (var i in node.Edges) {
    this.DelEdge(this.Edges[i]);
  }

  delete this.Nodes[node.ID];
};

Graph.prototype.DelEdge = function(edge) {
  delete edge.Parent.Edges[edge.ID];
  delete edge.Child.Edges[edge.ID];
  delete this.Edges[edge.ID];
};

Graph.prototype.InitFromSyncMessage = function(msg) {
  var g = msg.Obj;

  var i;
  for (i in g.Nodes || []) {
    var n = g.Nodes[i];

    var node = this.NewNode(n.ID);
    if ("Metadata" in n)
      node.Metadata = n.Metadata;
    node.Host = n.Host;
  }

  for (i in g.Edges || []) {
    var e = g.Edges[i];

    var parent = this.GetNode(e.Parent);
    var child = this.GetNode(e.Child);

    if (!parent || !child)
      continue;

    var edge = this.NewEdge(e.ID, parent, child);

    if ("Metadata" in e)
      edge.Metadata = e.Metadata;
    edge.Host = e.Host;
  }
};

var TopologyLayout = function(vm, selector) {
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

  setInterval(function() {
    // keep track of position once one drag occured
    if (self.keeplayout) {
      for (var i in self.nodes) {
        var node = self.nodes[i];
        lscache.set(self.nodes[i].Metadata.TID, {x: node.x, y: node.y, fixed: node.fixed}, self.lscachetimeout);
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
    .attr('viewBox', -this.width/2 + ' ' + -this.height/2 + ' ' + this.width * 2 + ' ' + this.height * 2)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  var _this = this;

  this.zoom = d3.behavior.zoom()
    .on("zoom", function() { _this.Rescale(); });

  this.force = d3.layout.force()
    .size([this.width, this.height])
    .charge(-400)
    .gravity(0.02)
    .linkStrength(0.5)
    .friction(0.8)
    .linkDistance(function(d, i) {
      return _this.LinkDistance(d, i);
    })
    .on("tick", function(e) {
      _this.Tick(e);
    });

  this.view = this.svg.append('g');

  this.svg.call(this.zoom)
    .on("dblclick.zoom", null);

  this.drag = this.force.stop().drag()
    .on("dragstart", function(d) {
      _this.keeplayout = true;
      d3.event.sourceEvent.stopPropagation();
    });

  this.groupsG = this.view.append("g")
    .attr("class", "groups")
    .on("click", function() {
      d3.event.preventDefault();
    });

  this.deferredActions = [];
  this.links = this.force.links();
  this.nodes = this.force.nodes();

  var linksG = this.view.append("g").attr("class", "links");
  this.link = linksG.selectAll(".link");

  var nodesG = this.view.append("g").attr("class", "nodes");
  this.node = nodesG.selectAll(".node");

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

TopologyLayout.prototype.LinkDistance = function(d, i) {
  var distance = 60;

  if (d.source.Group == d.target.Group) {
    if (d.source.Metadata.Type == "host") {
      for (var property in d.source.Edges)
        distance += 2;
      return distance;
=======
  @Watch('time')
  watchTime() {
    let self = this;
    if (this.timeId) {
      window.clearTimeout(this.timeId);
      this.timeId = null;
    }
    if (this.time !== 0) {
      this.timeId = window.setTimeout(function () {
        self.time -= 1;
      }, 1000 * 60);
>>>>>>> Front-end in typescript - 2
    }
  }

  @Watch('topologyTime')
  watchTopologyTime(at: number) {
    if (this.time === 0) {
      this.syncTopo();
    }
    else {
      this.syncTopo(at);
    }
  }

  get history() {
    return this.$store.state.history;
  }

  get isAnalyzer() {
    return this.$store.state.service === 'Analyzer';
  }

  get currentNode() {
    return this.$store.state.currentNode;
  }

  get live() {
    return this.time === 0;
  }

  get topologyTime(): number {
    let time = new Date();
    time.setMinutes(time.getMinutes() + this.time);
    time.setSeconds(0);
    time.setMilliseconds(0);
    return time.getTime();
  }

  get timeHuman(): string {
    return this.$store.getters.timeHuman;
  }

  get topologyTimeHuman(): string {
    if (this.live) {
      return 'live';
    }
    return -this.time + ' min. ago (' + this.timeHuman + ')';
  }

  get currentNodeFlowsQuery(): string {
    if (this.currentNode && this.currentNode.IsCaptureAllowed())
      return 'G.V(\'' + this.currentNode.ID + '\').Flows().Sort().Dedup()';
    return '';
  }

  get currentNodeMetadata(): { [key: string]: string; } {
    return this.extractMetadata(this.currentNode.Metadata, null, ['LastMetric', 'Statistics', '__']);
  }

  get currentNodeStats(): { [key: string]: string; } {
    return this.extractMetadata(this.currentNode.Metadata, 'Statistics');
  }

  get currentNodeLastStats(): { [key: string]: string; } {
    let s = this.extractMetadata(this.currentNode.Metadata, 'LastMetric');
    ['LastMetric/Start', 'LastMetric/Last'].forEach(function (k) {
      if (s[k]) {
        s[k] = new Date(s[k]).toLocaleTimeString();
      }
    });
    return s;
  }

  rescale(factor: number) {
    let width = this.layout.width,
      height = this.layout.height,
      translate = this.layout.zoom.translate(),
      newScale = this.layout.zoom.scale() * factor,
      newTranslate: [number, number] = [width / 2 + (translate[0] - width / 2) * factor,
      height / 2 + (translate[1] - height / 2) * factor];
    this.layout.zoom
      .scale(newScale)
      .translate(newTranslate)
      .event(this.layout.view);
  }

  zoomIn() {
    this.rescale(1.1);
  }

  zoomOut() {
    this.rescale(0.9);
  }

  zoomReset() {
    this.layout.zoom
      .scale(1)
      .translate([0, 0])
      .event(this.layout.view);
  }

  collapseAll() {
    this.collapsed = !this.collapsed;
    let nodes = this.layout.nodes;
    for (let i in nodes) {
      if (nodes[i].Metadata.Type !== 'host') {
        continue;
      }
<<<<<<< HEAD

      if ((edge.Parent == hostNode) || (edge.Child == hostNode)) {
        child = edge.Child;
        var found = false;
        for (var n in child.Edges) {
          nEdge = edge.Child.Edges[n];
          if (nEdge.Metadata.Type == "fabric")
            found = true;
            continue;
        }

        if (found)
          continue;
=======
      if (nodes[i].Collapsed !== this.collapsed) {
        this.layout.CollapseHost(nodes[i]);
        this.layout.Redraw();
>>>>>>> Front-end in typescript - 2
      }
    }
  }

  extractMetadata(metadata: { [key: string]: string }, namespace: string, exclude?: string[]): { [key: string]: string } {
    return Object.getOwnPropertyNames(metadata).reduce<{[key: string]: string; }>(function (mdata, key) {
      let use = true;
      if (namespace && key.search(namespace) === -1) {
        use = false;
      }
      if (exclude) {
        exclude.forEach(function (e) {
          if (key.search(e) !== -1) {
            use = false;
          }
        });
      }
      if (use) {
        mdata[key] = metadata[key];
      }
      return mdata;
    }, {});
  }

}


