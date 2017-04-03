/* jshint multistr: true */
import Vue from 'vue';
import { Component, Prop } from 'vue-property-decorator';

@Component({
  template: require('./object-detail.html')
})
export class ObjectDetail extends Vue {
  @Prop
  object: {};

  name = 'object-detail';

}

export function register() { Vue.component('object-detail', ObjectDetail); }