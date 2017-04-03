import Vue from 'vue';
import { Component, Prop, Watch } from 'vue-property-decorator';

interface Field {
  name: string[];
  label: string;
  show: boolean;
  showChanged: boolean;
}

@Component({
  template: require('./statistics-table.html')
})
export class StatisticsTable extends Vue {

  @Prop()
  object: {};

  fields: Field[];
  defaultFields: string[];

  data() {
    return {
      fields: [],
      defaultFields: ['RxBytes', 'RxPackets', 'TxBytes', 'TxPackets'],
    };
  }

  created() {
    this.generateFields();
  }

  @Watch('object')
  watchObject() {
    this.updateFields();
  }

  // check if all metrics eq to 0, after fields
  // are updated. if yes we show defaultFields
  @Watch('fields', { deep: true })
  watchFields() {

    if (this.zeroMetrics) {
      let self = this;
      this.fields.forEach(function (f) {
        if (self.defaultFields.indexOf(f.label) !== -1) {
          f.show = true;
        }
      });
    }
  }

  get time() {
    return this.$store.state.time;
  }

  get timeHuman() {
    return this.$store.getters.timeHuman;
  }

  get rows() {
    return [this.object];
  }

  get zeroMetrics() {
    let self = this;
    return this.fields.reduce(function (zero, f) {
      if (!self.isTime(f) && f.show === true) {
        zero = false;
      }
      return zero;
    }, true);
  }

  isTime(field) {
    return ['Start', 'Last'].indexOf(field.label) !== -1;
  }

  toggleField(field) {
    field.show = !field.show;
    // mark the field if is has been changed by the user
    field.showChanged = true;
  }

  generateFields() {
    // at creation show only fields that have a value gt 0
    let self = this;
    Object.getOwnPropertyNames(this.object).forEach(function (key) {
      let f = {
        name: [key],
        label: key.split('/')[1],
        show: false,
        showChanged: false
      };
      // put Start and Last fields at the beginning
      if (self.isTime(f)) {
        f.show = true;
        self.fields.splice(0, 0, f);
      } else {
        f.show = self.object[f.name[0]] > 0;
        self.fields.push(f);
      }
    });
  }

  updateFields() {
    // show field automatically if some value is gt 0
    // unless it has been hidden or showed manually by
    // the user.
    let self = this;
    this.fields.forEach(function (f) {
      let newVal = self.object[f.name[0]];
      if (f.showChanged === false) {
        if (newVal > 0 || self.isTime(f)) {
          f.show = true;
        } else {
          f.show = false;
        }
      }
    });
  }
}

export function register() { Vue.component('statistics-table', StatisticsTable); }