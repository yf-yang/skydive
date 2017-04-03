import * as $ from 'jquery';
import Vue from 'vue';
import { Component, Prop } from 'vue-property-decorator';

@Component({
  template: require('./node-selector.html')
})
export class NodeSelector extends Vue {
  @Prop()
  value: string;

  @Prop()
  placeholder: string;

  @Prop()
  attr: string = "Metadata.TID";

  select() {
    var self = this;
    $(".topology-d3").off('click');
    $(".topology-d3").on('click', function (e) {
      var value, node;
      if ((<any>!e.target).__data__) {
        return;
      } else {
        node = value = (<any> e.target).__data__;
      }

      self.attr.split(".").forEach(function (key) {
        if (!value[key]) {
          return;
        } else {
          value = value[key];
        }
      });

      self.$emit('input', value);
      self.$emit('selected', node);
      e.preventDefault();
      $(".topology-d3").off('click');
    });
  }

}


export function register() { Vue.component('node-selector', NodeSelector); }
