/* jshint multistr: true */
import { debounce } from '../../utils';
import Vue from 'vue';
import { Component, Prop } from 'vue-property-decorator';

@Component({
  template: require('./autocomplete.html'),

})
export class Autocomplete extends Vue {

  @Prop()
  value: string;
  @Prop()
  suggestions: () => Promise<string []>;
  @Prop()
  placeholder: string;

  open: boolean;
  current: number;
  fetchedSuggestions: string [];
  debouncedFetch: () => void;
  data() {
    return {
      open: false,
      current: 0,
      fetchedSuggestions: []
    };
  }

  get openSuggestion() {
    return this.value !== '' &&
      this.matches.length !== 0 &&
      this.open === true;
  }

  get matches() {
    let self = this;
    return this.fetchedSuggestions.filter(function (s) {
      return s.indexOf(self.value) >= 0;
    });
  }

  created() {
    this.debouncedFetch = debounce(this.fetchSuggestions, 400, false);
  }

  fetchSuggestions() {
    let self = this;
    this.suggestions()
      .then(function (data) {
        self.fetchedSuggestions = data;
      });
  }

  complete() {
    if (this.openSuggestion === true) {
      let value = this.matches[this.current] || this.value;
      this.open = false;
      this.$emit('input', value);
    }
  }

  click(index) {
    if (this.openSuggestion === true) {
      this.open = false;
      this.$emit('input', this.matches[index]);
    }
  }

  up() {
    if (this.current > 0)
      this.current--;
  }

  down() {
    if (this.current < this.matches.length - 1)
      this.current++;
  }

  isActive(index) {
    return index === this.current;
  }

  change(value) {
    this.debouncedFetch();
    if (this.open === false) {
      this.open = true;
      this.current = 0;
    }
    this.$emit('input', value);
  }
}

export function register() { Vue.component('autocomplete', Autocomplete); }
