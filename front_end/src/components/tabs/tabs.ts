/* jshint multistr: true */
import Vue from 'vue';
import { Component, Prop, Watch } from 'vue-property-decorator';

@Component({
  template: require('./tab-pane.html')
})
export class TabPane extends Vue {
  @Prop()
  title: string;

  get index() {
    return (this.$parent as Tabs).panes.indexOf(this);
  }

  get selected() {
    return this.index === (this.$parent as Tabs).selected;
  }

  created() {
    (this.$parent as Tabs).addPane(this);
  }

  beforeDestroy() {
    (this.$parent as Tabs).removePane(this);
  }

};

@Component({
  template: require('./tabs.html')
})
class Tabs extends Vue {

  panes: any[];
  selected: number;

  data() {
    return {
      panes: [],
      selected: 0
    };
  }

  select(index) {
    this.selected = index;
  }

  addPane(pane) {
    this.panes.push(pane);
  }

  removePane(pane) {
    var idx = this.panes.indexOf(pane);
    this.panes.splice(idx, 1);
    if (idx <= this.selected) {
      this.selected -= 1;
    }
  }

}

export function register() {
  Vue.component('tab-pane', TabPane);
  Vue.component('tabs', Tabs);
}