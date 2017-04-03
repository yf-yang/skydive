/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';
import { Prop, Watch } from 'vue-property-decorator';
import { debounce } from '../../utils';
import { apiMixin, ApiMixinContract } from '../../api';

@Component({
  mixins: [apiMixin],
  template: require('./filter-selector.html'),
})

class FilterSelector extends Vue implements ApiMixinContract {

  $topologyQuery: (q: string) => JQueryPromise<any>;
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
      key: "",
      value: "",
    };
  }

  get hasFilters() {
    return Object.keys(this.filters).length > 0;
  }

  keySuggestions() {
    return this.$topologyQuery(this.query + ".Keys()");
  }

  valueSuggestions() {
    if (!this.key)
      return $.Deferred().resolve([]);
    return this.$topologyQuery(this.query + ".Values('" + this.key + "').Dedup()")
      .then(function (values) {
        return values.map(function (v) { return v.toString(); });
      });
  }

  add() {
    if (this.key && this.value) {
      this.$emit('add', this.key, this.value);
      this.key = this.value = "";
    }
  }

  remove(key, index) {
    this.$emit('remove', key, index);
  }
};

@Component({
  template: require('./highlight-mode.html'),
})
class HighlightMode extends Vue {

  @Prop()
  value: string;

  highlightModes: { field: string, label: string }[];

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
    }
  }

  get buttonText() {
    var self = this;
    return this.highlightModes.reduce(function (acc, m) {
      if (m.field == self.value)
        return m.label;
      return acc;
    }, "");
  }

  select(mode) {
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
    return "Every " + this.value / 1000 + "s";
  }

  select(value) {
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
      return "No limit";
    }
    return "Limit: " + this.value;
  }

  valueText(value) {
    if (value === 0)
      return "No limit";
    return value;
  }

  select(value) {
    this.$emit('input', value);
  }
};


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

  queryResults: any[];
  queryError: string;
  limit: number
  sortBy: string[];
  sortOrder: number;
  interval: number;
  autoRefresh: boolean;
  showDetail: {};
  highlightMode: string;
  filters: {};
  fields: { name: string[], label: string, show: boolean }[];
  intervalId: number;

  data() {
    return {
      queryResults: [],
      queryError: "",
      limit: 30,
      sortBy: null,
      sortOrder: -1,
      interval: 1000,
      intervalId: null,
      autoRefresh: false,
      showDetail: {},
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
  watchAutoRefresh(newVal) {
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
  get showDetailField() {
    if (this.value.search('Dedup') !== -1) {
      return 'TrackingID';
    }
    return 'UUID';
  }

  get timedQuery() {
    return this.setQueryTime(this.value);
  }

  get filteredQuery() {
    var filteredQuery = this.timedQuery;
    for (var k of Object.keys(this.filters)) {
      if (this.filters[k].length === 1) {
        filteredQuery += ".Has('" + k + "', '" + this.filters[k][0] + "')";
      }
      else if (this.filters[k].length > 1) {
        var values = this.filters[k].join("','");
        filteredQuery += ".Has('" + k + "', within('" + values + "'))";
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
    var self = this;
    this.$topologyQuery(this.limitedQuery)
      .then(function (flows) {
        // much faster than replacing
        // the array with vuejs
        self.queryResults.splice(0);
        flows.forEach(function (f) {
          self.queryResults.push(f);
        });
      })
      .fail(function (r) {
        self.queryError = r.responseText + "Query was : " + self.limitedQuery;
        self.stopAutoRefresh();
      });
  }

  setQueryTime(query) {
    if (this.time !== 0) {
      return query.replace("G.", "G.At(" + this.time + ").");
    }
    return query;
  }

  hasFlowDetail(flow) {
    return this.showDetail[flow[this.showDetailField]] || false;
  }

  // Keep track of which flow detail we should display
  toggleFlowDetail(flow) {
    if (this.showDetail[flow[this.showDetailField]]) {
      Vue.delete(this.showDetail, flow[this.showDetailField]);
    } else {
      Vue.set(this.showDetail, flow[this.showDetailField], true);
    }
  }

  highlightNodes(obj, bool) {
    var self = this,
      query = "G.Flows().Has('" + this.highlightMode + "', '" + obj[this.highlightMode] + "').Nodes()";
    query = this.setQueryTime(query);
    this.$topologyQuery(query)
      .then(function (nodes) {
        nodes.forEach(function (n) {
          if (bool)
            self.$store.commit('highlight', n.ID);
          else
            self.$store.commit('unhighlight', n.ID);
          //if (n.Metadata.TID == obj.NodeTID) {
          //topologyLayout.SetNodeClass(n.ID, "current", bool);
          //}
        });
      });
  }

  compareFlows(f1, f2) {
    if (!this.sortBy) {
      return 0;
    }
    var f1FieldValue = this.fieldValue(f1, this.sortBy),
      f2FieldValue = this.fieldValue(f2, this.sortBy);
    if (f1FieldValue < f2FieldValue)
      return -1 * this.sortOrder;
    if (f1FieldValue > f2FieldValue)
      return 1 * this.sortOrder;
    return 0;
  }

  fieldValue(object, paths) {
    for (var path of paths) {
      var value = object;
      for (var k of path.split(".")) {
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
    return "";
  }

  sort(sortBy) {
    this.sortBy = sortBy;
  }

  order(sortOrder) {
    this.sortOrder = sortOrder;
  }

  addFilter(key, value) {
    if (!this.filters[key]) {
      Vue.set(this.filters, key, []);
    }
    this.filters[key].push(value);
  }

  removeFilter(key, index) {
    this.filters[key].splice(index, 1);
    if (this.filters[key].length === 0) {
      Vue.delete(this.filters, key);
    }
  }

  toggleField(field) {
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
      query: "G.Flows().Sort()",
      validatedQuery: "G.Flows().Sort()",
      validationId: null,
      error: "",
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
    var self = this;
    this.$topologyQuery(self.query)
      .then(function () {
        self.validatedQuery = self.query;
        self.error = "";
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

