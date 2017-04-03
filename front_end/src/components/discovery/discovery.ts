/* jshint multistr: true */
import Vue from 'vue';
import { Component, Watch } from 'vue-property-decorator'
import * as d3 from 'd3';

interface Breadcrumb {
  w: number;
  h: number;
  s: number;
  t: number;
}

interface DiscoveryNode extends d3.layout.partition.Node, d3.svg.arc.Arc {
  name: string;
  size: number;
  // for interpolate
  x0?: number;
  dx0?: number;
}

@Component({
  template: require('./discovery.html')
})

export class DiscoveryComponent extends Vue {

  layout: DiscoveryLayout;

  name = 'discovery'
  protocolData: {};
  type: string;
  mode: string;

  data() {
    return {
      protocolData: null,
      type: 'bytes',
      mode: 'count',
    };
  }

  mounted() {
    this.layout = new DiscoveryLayout(this, '.discovery-d3');
    this.layout.DrawChart(this.type);
  }

  @Watch('type')
  watchType() {
    this.layout.DrawChart(this.type);
  }

  @Watch('mode')
  watchMode() {
    this.layout.ChangeMode(this.mode);
  }
}

interface ProtocolData { Name: string; Percentage: string; Size: number; Value: number; Depth: number }

class DiscoveryLayout {
  width: number;
  height: number;
  radius: number;
  color: d3.scale.Ordinal<string, string>;
  vm: { node: any, protocolData: ProtocolData };
  b: Breadcrumb;
  svg: d3.Selection<any>;
  partition: d3.layout.Partition<DiscoveryNode>;
  path: d3.Selection<DiscoveryNode>;
  arc: d3.svg.Arc<DiscoveryNode>;
  frameElement: string;


  constructor(vm, selector) {
    this.vm = vm;
    this.width = 680;
    this.height = 600;
    this.radius = (Math.min(this.width, this.height) / 2) - 50;
    this.color = d3.scale.category20c();
    this.frameElement = selector;

    // Breadcrumb dimensions: width, height, spacing, width of tip/tail.
    this.b = {
      w: 75, h: 30, s: 3, t: 10
    };

    this.svg = d3.select(selector).append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .append('g')
      .attr('id', 'container')
      .attr('transform', 'translate(' + this.width / 2 + ',' + this.height * 0.52 + ')');

    this.partition = (d3.layout.partition() as d3.layout.Partition<DiscoveryNode>)
      .sort(null)
      .size([2 * Math.PI, this.radius * this.radius])
      .value(function (d) { return 1; });

    this.arc = (d3.svg.arc() as d3.svg.Arc<DiscoveryNode>)
      .startAngle(function (d) { return d.x; })
      .endAngle(function (d) { return d.x + d.dx; })
      .innerRadius(function (d) { return Math.sqrt(d.y); })
      .outerRadius(function (d) { return Math.sqrt(d.y + d.dy); });

    this.initializeBreadcrumbTrail();
  }


  ChangeMode(mode) {
    var self = this;
    var value = mode === 'count' ? function () { return 1; } : function (d) { return d.size; };

    // Interpolate the arcs in data space.
    function arcTween(a: DiscoveryNode): (t: number) => d3.Primitive {
      var i = d3.interpolate<number, number>({ x: a.x0, dx: a.dx0 }, a as any);
      return function (t: number) {
        var b = i(t);
        a.x0 = b.x;
        a.dx0 = b.dx;
        return self.arc(b as any);
      };
    }

    this.path
      .data(this.partition.value(value).nodes)
      .transition()
      .duration(1500)
      .attrTween('d', arcTween);
  }

  DrawChart(type) {
    var totalSize = 0;
    this.svg.selectAll('*').remove();
    var self = this;
    d3.json('/api/flow/discovery/' + type, function (root) {
      self.path = self.svg.datum(root).selectAll('path')
        .data(self.partition.nodes)
        .enter().append('path')
        .attr('display', function (d) { return d.depth ? null : 'none'; }) // hide inner ring
        .attr('d', self.arc)
        .style('stroke', '#fff')
        .style('fill', function (d) { return self.color((d.children ? d : (d.parent as DiscoveryNode)).name); })
        .style('fill-rule', 'evenodd')
        .on('mouseover', mouseover)
        .each(stash);
      totalSize = (self.path.node() as any).__data__.value;

      // Add the mouseleave handler to the bounding circle
      d3.select('#container').on('mouseleave', mouseleave);
    });

    // On mouseover function
    function mouseover(d: DiscoveryNode) {
      var percentage = (100 * d.value / totalSize).toPrecision(3) + ' %';
      self.vm.protocolData = {
        'Name': d.name,
        'Percentage': percentage,
        'Size': d.size,
        'Value': d.value,
        'Depth': d.depth
      };
      var sequenceArray = getAncestors(d);
      updateBreadcrumbs(sequenceArray, percentage);
    }

    // On mouseleave function
    function mouseleave(d) {
      d3.select('#trail')
        .style('visibility', 'hidden');
      self.vm.protocolData = null;
    }

    // Given a node in a partition layout, return an array of all of its ancestor
    // nodes, highest first, but excluding the root.
    function getAncestors(node) {
      var path = [];
      var current = node;
      while (current.parent) {
        path.unshift(current);
        current = current.parent;
      }
      return path;
    }

    // Generate a string that describes the points of a breadcrumb polygon.
    function breadcrumbPoints(d, i) {
      var points = [];
      points.push('0,0');
      points.push(self.b.w + ',0');
      points.push(self.b.w + self.b.t + ',' + (self.b.h / 2));
      points.push(self.b.w + ',' + self.b.h);
      points.push('0,' + self.b.h);
      if (i > 0) { // Leftmost breadcrumb; don't include 6th vertex.
        points.push(self.b.t + ',' + (self.b.h / 2));
      }
      return points.join(' ');
    }

    //Update the breadcrumb trail to show the current sequence and percentage.
    function updateBreadcrumbs(nodeArray: DiscoveryNode[], percentageString: string) {

      // Data join; key function combines name and depth (= position in sequence).
      var g = d3.select('#trail')
        .selectAll('g')
        .data<DiscoveryNode>(nodeArray, function (d) { return d.name + d.depth; });

      // Add breadcrumb and label for entering nodes.
      var entering = g.enter().append('svg:g');

      entering.append('svg:polygon')
        .attr('points', breadcrumbPoints)
        .style('fill', function (d: DiscoveryNode) { return self.color((d.children ? d : (d.parent as DiscoveryNode)).name); });

      entering.append('svg:text')
        .attr('x', (self.b.w + self.b.t) / 2)
        .attr('y', self.b.h / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .text(function (d) { return d.name; });

      // Set position for entering and updating nodes.
      g.attr('transform', function (d, i) {
        return 'translate(' + i * (self.b.w + self.b.s) + ', 0)';
      });

      // Remove exiting nodes.
      g.exit().remove();

      // Now move and update the percentage at the end.
      d3.select('#trail').select('#endlabel')
        .attr('x', (nodeArray.length + 0.5) * (self.b.w + self.b.s))
        .attr('y', self.b.h / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .text(percentageString);

      // Make the breadcrumb trail visible, if it's hidden.
      d3.select('#trail')
        .style('visibility', '');
    }

    // Stash the old values for transition.
    function stash(d) {
      d.x0 = d.x;
      d.dx0 = d.dx;
    }

    d3.select(self.frameElement).style('height', this.height + 'px');
  }

  initializeBreadcrumbTrail() {
    // Add the svg area.
    var trail = d3.select('#sequence').append('svg:svg')
      .attr('width', this.width)
      .attr('height', 50)
      .attr('id', 'trail');
    // Add the label at the end, for the percentage.
    trail.append('svg:text')
      .attr('id', 'endlabel')
      .style('fill', '#fff');
  }
}
