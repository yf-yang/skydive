/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';
import { Prop, Watch } from 'vue-property-decorator';
import { debounce } from '../../utils';
import { apiMixin, ApiMixinContract, FlowReply, NodeReply, Reply } from '../../api';

@Component({
  mixins: [apiMixin],
  template: require('./filter-selector.html'),
})

class FilterSelector extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<Reply[]>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  @Prop()
  filters: {};

  @Prop()
  query: string;

  key: string;
  value: string;

  data() {
    return {
      key: '',
      value: '',
    };
  }

  get hasFilters() {
    return Object.keys(this.filters).length > 0;
  }

  keySuggestions() {
    return this.$topologyQuery(this.query + '.Keys()');
  }

  valueSuggestions() {
    if (!this.key)
      return $.Deferred().resolve([]);
    return this.$topologyQuery(this.query + '.Values(\'' + this.key + '\').Dedup()')
      .then(function (values: Reply[] ) {
        return values.map(function (v) { return v.toString(); });
      });
  }

  add() {
    if (this.key && this.value) {
      this.$emit('add', this.key, this.value);
      this.key = this.value = '';
    }
  }

  remove(key: string, index: number) {
    this.$emit('remove', key, index);
  }
};

interface Mode { 
  field: string;
  label: string;
}

@Component({
  template: require('./highlight-mode.html'),
})
class HighlightMode extends Vue {

  @Prop()
  value: string;

  highlightModes: Mode [];

  data() {
    return {
      highlightModes: [
        {
          field: 'TrackingID',
          label: 'Follow L2',
        },
        {
          field: 'L3TrackingID',
          label: 'Follow L3',
        }
      ]
    };
  }

  get buttonText() {
    let self = this;
    return this.highlightModes.reduce(function (acc, m) {
      if (m.field === self.value)
        return m.label;
      return acc;
    }, '');
  }

  select(mode: Mode) {
    this.$emit('input', mode.field);
  }
};

@Component({
  template: require('./interval-button.html'),
})
class IntervalButton extends Vue {
  @Prop()
  value: number;

  values: number[];
  data() {
    return {
      values: [1000, 5000, 10000, 20000, 40000]
    };
  }

  get intervalText() {
    return 'Every ' + this.value / 1000 + 's';
  }

  select(value: number) {
    this.$emit('input', value);
  }
};

@Component({
  template: require('./limit-button.html')
})
class LimitButton extends Vue {
  @Prop()
  value: number;

  values: number[];
  data() {
    return {
      values: [10, 30, 50, 100, 200, 500, 0]
    };
  }

  get buttonText() {
    if (this.value === 0) {
      return 'No limit';
    }
    return 'Limit: ' + this.value;
  }

  valueText(value: number) {
    if (value === 0)
      return 'No limit';
    return value;
  }

  select(value: number) {
    this.$emit('input', value);
  }
};

interface Field {
  name: string[];
  label: string;
  show: boolean;
}

@Component({
  template: require('./flow-table.html'),
  mixins: [apiMixin],
  components: {
    'interval-button': IntervalButton,
    'highlight-mode': HighlightMode,
    'filter-selector': FilterSelector,
    'limit-button': LimitButton,
  }
})
class FlowTable extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  @Prop()
  value: string;

  queryResults: FlowReply [];
  queryError: string;
  limit: number;
  sortBy: string[];
  sortOrder: number;
  interval: number;
  autoRefresh: boolean;
  showDetail: {[key: string]: boolean; };
  highlightMode: string;
  filters: { [key: string]: {}[]; };
  fields: Field[];
  intervalId: number;

  data() {
    return {
      queryResults: [] as FlowReply [],
      queryError: '',
      limit: 30,
      sortBy: null as string [],
      sortOrder: -1,
      interval: 1000,
      intervalId: null as number,
      autoRefresh: false,
      showDetail: { } as { [key: string]: boolean; },
      highlightMode: 'TrackingID',
      filters: {},
      fields: [
        {
          name: ['UUID'],
          label: 'UUID',
          show: false,
        },
        {
          name: ['LayersPath'],
          label: 'Layers',
          show: false,
        },
        {
          name: ['Application'],
          label: 'App.',
          show: true,
        },
        {
          name: ['Network.Protocol', 'Link.Protocol'],
          label: 'Proto.',
          show: false,
        },
        {
          name: ['Network.A', 'Link.A'],
          label: 'A',
          show: true,
        },
        {
          name: ['Network.B', 'Link.B'],
          label: 'B',
          show: true,
        },
        {
          name: ['Transport.Protocol'],
          label: 'L4 Proto.',
          show: false,
        },
        {
          name: ['Transport.A'],
          label: 'A port',
          show: false,
        },
        {
          name: ['Transport.B'],
          label: 'B port',
          show: false,
        },
        {
          name: ['Metric.ABPackets'],
          label: 'AB Pkts',
          show: true,
        },
        {
          name: ['Metric.BAPackets'],
          label: 'BA Pkts',
          show: true,
        },
        {
          name: ['Metric.ABBytes'],
          label: 'AB Bytes',
          show: true,
        },
        {
          name: ['Metric.BABytes'],
          label: 'BA Bytes',
          show: true,
        },
        {
          name: ['TrackingID'],
          label: 'L2 Tracking ID',
          show: false,
        },
        {
          name: ['L3TrackingID'],
          label: 'L3 Tracking ID',
          show: false,
        },
        {
          name: ['NodeTID'],
          label: 'Interface',
          show: false,
        },
      ]
    };
  }

  created() {
    // sort by Application by default
    this.sortBy = this.fields[2].name;
    this.getFlows();
  }

  beforeDestroy() {
    this.stopAutoRefresh();
  }


  @Watch('autoRefresh')
  watchAutoRefresh(newVal: boolean) {
    if (newVal === true)
      this.startAutoRefresh();
    else
      this.stopAutoRefresh();
  }

  @Watch('interval')
  watchInterval() {
    this.stopAutoRefresh();
    this.startAutoRefresh();
  }

  @Watch('value')
  watchValue() {
    this.getFlows();
  }

  @Watch('limitedQuery')
  watchLimiteQuery() {
    this.getFlows();
  }

  get time() {
    return this.$store.state.time;
  }

  get timeHuman() {
    return this.$store.getters.timeHuman;
  }

  get sortedResults() {
    return this.queryResults.sort(this.compareFlows);
  }

  // When Dedup() is used we show the detail of
  // the flow using TrackingID because the flow
  // returned has not always the same UUID
  get showDetailField(): string {
    if (this.value.search('Dedup') !== -1) {
      return 'TrackingID';
    }
    return 'UUID';
  }

  get timedQuery(): string {
    return this.setQueryTime(this.value);
  }

  get filteredQuery() {
    let filteredQuery = this.timedQuery;
    for (let k of Object.keys(this.filters)) {
      if (this.filters[k].length === 1) {
        filteredQuery += '.Has(\'' + k + '\', \'' + this.filters[k][0] + '\')';
      }
      else if (this.filters[k].length > 1) {
        let values = this.filters[k].join('\',\'');
        filteredQuery += '.Has(\'' + k + '\', within(\'' + values + '\'))';
      }
    }
    return filteredQuery;
  }

  get limitedQuery() {
    if (this.limit === 0) {
      return this.filteredQuery;
    }
    return this.filteredQuery + '.Limit(' + this.limit + ')';
  }


  startAutoRefresh() {
    this.intervalId = window.setInterval(this.getFlows.bind(this), this.interval);
  }

  stopAutoRefresh() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getFlows() {
    let self = this;
    this.$topologyQuery(this.limitedQuery)
      .then(function (flows: FlowReply[]) {
        // much faster than replacing
        // the array with vuejs
        self.queryResults.splice(0);
        flows.forEach(function (f: FlowReply) {
          self.queryResults.push(f);
        });
      })
      .fail(function (r) {
        self.queryError = r.responseText + 'Query was : ' + self.limitedQuery;
        self.stopAutoRefresh();
      });
  }

  setQueryTime(query: string) {
    if (this.time !== 0) {
      return query.replace('G.', 'G.At(' + this.time + ').');
    }
    return query;
  }

  hasFlowDetail(flow: FlowReply) {
    return this.showDetail[flow[this.showDetailField]] || false;
  }

  // Keep track of which flow detail we should display
  toggleFlowDetail(flow: FlowReply) {
    if (this.showDetail[flow[this.showDetailField]]) {
      Vue.delete(this.showDetail, flow[this.showDetailField]);
    } else {
      Vue.set(this.showDetail, flow[this.showDetailField], true);
    }
  }

  highlightNodes(obj: any, bool: boolean) {
    let self = this,
      query = 'G.Flows().Has(\'' + this.highlightMode + '\', \'' + obj[this.highlightMode] + '\').Nodes()';
    query = this.setQueryTime(query);
    this.$topologyQuery(query)
      .then(function (nodes: NodeReply []) {
        nodes.forEach(function (n) {
          if (bool)
            self.$store.commit('highlight', n.ID);
          else
            self.$store.commit('unhighlight', n.ID);
          // if (n.Metadata.TID == obj.NodeTID) {
          //   topologyLayout.SetNodeClass(n.ID, 'current', bool);
          // }
        });
      });
  }

  compareFlows(f1: FlowReply , f2: FlowReply) {
    if (!this.sortBy) {
      return 0;
    }
    let f1FieldValue = this.fieldValue(f1, this.sortBy),
      f2FieldValue = this.fieldValue(f2, this.sortBy);
    if (f1FieldValue < f2FieldValue)
      return -1 * this.sortOrder;
    if (f1FieldValue > f2FieldValue)
      return 1 * this.sortOrder;
    return 0;
  }

  fieldValue(object: any, paths: string []) {
    for (let path of paths) {
      let value = object;
      for (let k of path.split('.')) {
        if (value[k] !== undefined) {
          value = value[k];
        } else {
          value = null;
          break;
        }
      }
      if (value !== null) {
        return value;
      }
    }
    return '';
  }

  sort(sortBy: string []) {
    this.sortBy = sortBy;
  }

  order(sortOrder: number) {
    this.sortOrder = sortOrder;
  }

  addFilter(key: string, value: string) {
    if (!this.filters[key]) {
      Vue.set(this.filters, key, []);
    }
    this.filters[key].push(value);
  }

  removeFilter(key: string, index: number) {
    this.filters[key].splice(index, 1);
    if (this.filters[key].length === 0) {
      Vue.delete(this.filters, key);
    }
  }

  toggleField(field: Field) {
    field.show = !field.show;
  }
}


@Component({
  template: require('./flow-table-control.html'),
  mixins: [apiMixin]
})
class FlowTableControl extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q: string, n: string, d: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  debouncedValidation: () => void;

  query: string;
  validatedQuery: string;
  validationId: string;
  error: string;

  data() {
    return {
      query: 'G.Flows().Sort()',
      validatedQuery: 'G.Flows().Sort()',
      validationId: null as string,
      error: '',
    };
  }

  created() {
    this.debouncedValidation = debounce(this.validateQuery, 400);
  }

  @Watch('query')
  watchQuery() {
    this.debouncedValidation();
  }

  get time() {
    return this.$store.state.time;
  }

  get timeHuman() {
    return this.$store.getters.timeHuman;
  }


  validateQuery() {
    let self = this;
    this.$topologyQuery(self.query)
      .then(function () {
        self.validatedQuery = self.query;
        self.error = '';
      })
      .fail(function (e) {
        self.error = e.responseText;
      });
  }

}

export function register() {
  Vue.component('flow-table', FlowTable);
  Vue.component('flow-table-control', FlowTableControl);
}

