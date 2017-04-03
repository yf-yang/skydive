/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';
import { Watch, Prop } from 'vue-property-decorator';
import { apiMixin, ApiMixinContract } from '../../api';
import { websocket } from '../../app';

@Component({
  mixins: [apiMixin],
  template: require('./capture.html')
})
class Capture extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  @Prop()
  capture: { GremlinQuery: any };

  showFlows: boolean;
  deleting: boolean;

  data() {
    return {
      showFlows: false,
      deleting: false,
    };
  }

  get canShowFlows() {
    return this.capture.GremlinQuery.search('ShortestPathTo') === -1;
  };

  remove(capture) {
    let self = this,
      uuid = capture.UUID;
    this.deleting = true;
    this.$captureDelete(uuid)
      .always(function () {
        self.deleting = false;
      });
  }

  highlightCaptureNodes(capture, bool) {
    let self = this;
    // Avoid highlighting the nodes while the capture
    // is being deleted
    if (this.deleting) {
      return;
    }
    this.$topologyQuery(capture.GremlinQuery)
      .then(function (nodes) {
        nodes.forEach(function (n) {
          if (bool)
            self.$store.commit('highlight', n.ID);
          else
            self.$store.commit('unhighlight', n.ID);
        });
      });
  }
}

@Component({
  template: require('./capture-list.html'),
  mixins: [apiMixin],
  components: { 'capture': Capture }
})
export class CaptureList extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  captures: {};
  deleting: {}[];
  timer: {};

  data() {
    return {
      captures: {},
      deleting: [],
      timer: null
    };
  }

  created() {
    websocket.addMsgHandler('OnDemand', this.onMsg.bind(this));
    websocket.addConnectHandler(this.init.bind(this));
  }

  beforeDestroy() {
    websocket.delConnectHandler(this.init.bind(this));
  }

  get count() {
    return Object.keys(this.captures).length;
  }

  init() {
    let self = this;
    this.$captureList()
      .then(function (data) {
        self.captures = data;
      });
  }

  onMsg(msg) {
    switch (msg.Type) {
      case 'CaptureDeleted':
        Vue.delete(this.captures, msg.Obj.UUID);
        break;
      case 'CaptureAdded':
        Vue.set(this.captures, msg.Obj.UUID, msg.Obj);
        break;
    }
  }
}

export function register() { Vue.component('capture-list', CaptureList); }
