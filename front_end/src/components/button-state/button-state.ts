/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';

@Component({
    template: require('./button-state.html'),
    props: {

        value: {
            type: Boolean,
            required: true,
        },

        enabledText: {
            type: String,
            required: true,
        },

        disabledText: {
            type: String,
            required: true,
        }

    }
})
export class ButtonState extends Vue {
    value: boolean;
    enabledText: string;
    disabledText: string;

    change() {
        this.$emit('input', !this.value);
    }

}

export function register() { Vue.component('button-state', ButtonState); }
