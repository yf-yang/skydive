/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';
import { Watch, Prop } from 'vue-property-decorator';
import { apiMixin, ApiMixinContract, NodeReply } from '../../api';
import { NotificationMixinContract, notificationMixin, NotifOptions } from '../notifications/notifications';

@Component({
  template: require('./capture-form.html'),
  mixins: [apiMixin, notificationMixin]
})
export class CaptureForm extends Vue implements NotificationMixinContract, ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<NodeReply[]>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string, b: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  $notify: (options: NotifOptions) => void;
  $error: (options: NotifOptions) => void;
  $success: (options: NotifOptions) => void;


  node1: string;
  node2: string;
  queryNodes: NodeReply [];
  name: string;
  desc: string;
  bpf: string;
  userQuery: string;
  mode: string;
  visible: boolean;

  data() {
    return {
      node1: '',
      node2: '',
      queryNodes: [] as NodeReply [],
      name: '',
      desc: '',
      bpf: '',
      userQuery: '',
      mode: 'selection',
      visible: false,
    };
  }

  beforeDestroy() {
    this.resetQueryNodes();
  }

  get queryError() {
    if (this.mode === 'gremlin' && !this.userQuery) {
      return 'Gremlin query can\'t be empty';
    } else if (this.mode === 'selection' && !this.node1) {
      return 'At least one interface has to be selected';
    } else {
      return null;
    }
  }

  get query() {
    if (this.queryError) {
      return null;
    }
    if (this.mode === 'gremlin') {
      return this.userQuery;
    } else {
      let q = 'G.V().Has(\'TID\', \'' + this.node1 + '\')';
      if (this.node2)
        q += '.ShortestPathTo(Metadata(\'TID\', \'' + this.node2 + '\'), Metadata(\'RelationType\', \'layer2\'))';
      return q;
    }
  }

  @Watch('visible')
  watchVisible(newValue: boolean) {
    if (newValue === true &&
      this.$store.state.currentNode &&
      this.$store.state.currentNode.IsCaptureAllowed() &&
      this.$store.state.currentNode.Metadata.TID) {
      this.node1 = this.$store.state.currentNode.Metadata.TID;
    }
  }

  @Watch('query')
  watchQuery(newQuery: string) {
    let self = this;
    if (!newQuery) {
      this.resetQueryNodes();
      return;
    }
    this.$topologyQuery(newQuery)
      .then(function (nodes) {
        self.resetQueryNodes();
        self.queryNodes = nodes;
        self.highlightQueryNodes(true);
      })
      .fail(function () {
        self.resetQueryNodes();
      });
  }

  reset() {
    this.node1 = this.node2 = this.userQuery = '';
    this.name = this.desc = this.bpf = '';
    this.visible = false;
  }

  start() {
    let self = this;
    if (this.queryError) {
      this.$error({ message: this.queryError });
      return;
    }
    this.$captureCreate(this.query, this.name, this.desc, this.bpf)
      .then(function () {
        self.reset();
      });
  }

  resetQueryNodes() {
    this.highlightQueryNodes(false);
    this.queryNodes = [];
  }

  highlightQueryNodes(bool: boolean) {
    let self = this;
    this.queryNodes.forEach(function (n) {
      if (bool)
        self.$store.commit('highlight', n.ID);
      else
        self.$store.commit('unhighlight', n.ID);
    });
  }

}

export function register() { Vue.component('capture-form', CaptureForm); }
