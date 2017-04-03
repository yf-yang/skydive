import Vue from 'vue';
import Component from 'vue-class-component';
import {Prop} from 'vue-property-decorator';

@Component({
    template: require('./dynamic-table.html')
})
class DynamicTable extends Vue {
    @Prop()
    rows: string [];

    @Prop()
    error: string;

    @Prop({required: true}) 
    fields: { name: string, label: string, show: boolean } [];

    @Prop()
    sortOrder: number;

    @Prop()
    sortBy: string [];


   get visibleFields() {
      return this.fields.filter(function(f) {
        return f.show === true;
      });
    }

    sort(name) {
      if (name == this.sortBy) {
        this.$emit('order', this.sortOrder * -1);
      } else {
        this.$emit('sort', name);
      }
    }

    toggleField(field, index) {
      this.$emit('toggleField', field, index);
    }

    fieldValue(object, key) {
      return object[key[0]];
    }
}

export function register() { Vue.component('dynamic-table', DynamicTable); }