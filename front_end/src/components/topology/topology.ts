/* jshint multistr: true */
import Vue from 'vue';
import { Component, Watch } from 'vue-property-decorator';
import { ApiMixinContract, apiMixin } from '../../api';
import { NotificationMixinContract, notificationMixin, NotifOptions } from '../notifications/notifications';
import * as d3 from 'd3';
import { debounce } from '../../utils';
import { TopologyLayout } from './layout';

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
      resize: function (event, ui) {
        let x = ui.element.outerWidth();
        let y = ui.element.outerHeight();
        let ele = ui.element;
        let factor = $(this).parent().width() - x;
        let f2 = $(this).parent().width() * 0.02999;
        $.each(ele.siblings(), function (idx, item) {
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
    }
  }

  @Watch('topologyTime')
  watchTopologyTime(at) {
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

  get topologyTime() {
    let time = new Date();
    time.setMinutes(time.getMinutes() + this.time);
    time.setSeconds(0);
    time.setMilliseconds(0);
    return time.getTime();
  }

  get timeHuman() {
    return this.$store.getters.timeHuman;
  }

  get topologyTimeHuman() {
    if (this.live) {
      return 'live';
    }
    return -this.time + ' min. ago (' + this.timeHuman + ')';
  }

  get currentNodeFlowsQuery() {
    if (this.currentNode && this.currentNode.IsCaptureAllowed())
      return 'G.V(\'' + this.currentNode.ID + '\').Flows().Sort().Dedup()';
    return '';
  }

  get currentNodeMetadata() {
    return this.extractMetadata(this.currentNode.Metadata, null, ['LastMetric', 'Statistics', '__']);
  }

  get currentNodeStats() {
    return this.extractMetadata(this.currentNode.Metadata, 'Statistics');
  }

  get currentNodeLastStats() {
    let s = this.extractMetadata(this.currentNode.Metadata, 'LastMetric');
    ['LastMetric/Start', 'LastMetric/Last'].forEach(function (k) {
      if (s[k]) {
        s[k] = new Date(s[k]).toLocaleTimeString();
      }
    });
    return s;
  }

  rescale(factor) {
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
      if (nodes[i].Collapsed !== this.collapsed) {
        this.layout.CollapseHost(nodes[i]);
        this.layout.Redraw();
      }
    }
  }

  extractMetadata(metadata: { [key: string]: string }, namespace: string, exclude?: string[]): { [key: string]: string } {
    return Object.getOwnPropertyNames(metadata).reduce(function (mdata, key) {
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


