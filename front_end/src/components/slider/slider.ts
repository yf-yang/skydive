/* jshint multistr: true */
import Vue from 'vue';
import { Component, Prop, Watch } from 'vue-property-decorator';

@Component({
  template: require('./slider.html')
})
export class Slider extends Vue {
  @Prop({ default: 0 })
  value: number;

  @Prop()
  min: number;

  @Prop()
  max: number;

  @Prop({ default: 1 })
  step: number;

  @Prop()
  info: string;

  val: string;

  data() {
    return {
      val: '' + this.value
    };
  }

  @Watch('val')
  watchVal() {
    this.$emit('input', parseInt(this.val));
  }
}

export function register() { Vue.component('slider', Slider); }