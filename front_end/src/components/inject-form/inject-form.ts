/* jshint multistr: true */
import Vue from 'vue';
import { Component, Watch } from 'vue-property-decorator';
import { apiMixin } from '../../api';
import { notificationMixin, NotifOptions, NotificationMixinContract } from '../notifications/notifications';

@Component({
  mixins: [apiMixin, notificationMixin],
  template: require('./inject-form.html')
})

class InjectForm extends Vue implements NotificationMixinContract {
  
  $notify: (options: NotifOptions) => void;
  $error:  (options: NotifOptions) => void;
  $success:  (options: NotifOptions) => void;

  node1: string;
  node2: string;
  count: number;
  type: string;

  data() {
    return {
      node1: '',
      node2: '',
      count: 1,
      type: 'icmp',
    };
  }

  created() {
    if (this.$store.state.currentNode) {
      this.node1 = this.$store.state.currentNode.ID;
    }
  }

  beforeDestroy() {
    // FIXME: we should just call reset() here,
    // but the watchers are not being evaluated :/
    if (this.node1) {
      this.highlightNode(this.node1, false);
    }
    if (this.node2) {
      this.highlightNode(this.node2, false);
    }
  }

  get error() {
    if (!this.node1 || !this.node2) {
      return 'Source and destination interfaces must be selected';
    } else {
      return;
    }
  }

  @Watch('node1')
  watchNode1(newVal, oldVal) {
    if (oldVal) {
      this.highlightNode(oldVal, false);
    }
    this.highlightNode(newVal, true);
  }

  @Watch('node2')
  watchNode2(newVal, oldVal) {
    if (oldVal) {
      this.highlightNode(oldVal, false);
    }
    this.highlightNode(newVal, true);
  }

  highlightNode(id, bool) {
    if (bool)
      this.$store.commit('highlight', id);
    else
      this.$store.commit('unhighlight', id);
  }

  reset() {
    let self = this;
    this.node1 = this.node2 = '';
    this.count = 1;
    this.type = 'icmp';
  }

  inject() {
    let self = this;
    if (this.error) {
      this.$error({ message: this.error });
      return;
    }
    $.ajax({
      dataType: 'json',
      url: '/api/injectpacket',
      data: JSON.stringify({
        'Src': 'G.V(\'' + this.node1 + '\')',
        'Dst': 'G.V(\'' + this.node2 + '\')',
        'Type': this.type,
        'Count': this.count
      }),
      contentType: 'application/json; charset=utf-8',
      method: 'POST',
    })
      .then(function () {
        self.$success({ message: 'Packet injected' });
      })
      .fail(function (e) {
        self.$error({ message: 'Packet injection error: ' + e.responseText });
      });
  }

}

export function register() { Vue.component('inject-form', InjectForm); }
