import Vue from 'vue';
import Component from 'vue-class-component';

@Component({
    template: require('./button-dropdown.html'),

    props: {

        // Button text
        text: {
            type: String,
        },

        // Button css classes
        bClass: {},

        // Can be also up/down
        // auto will calculate if there is enough
        // room to put the menu down, if not it will
        // be up.
        position: {
            type: String,
            default: "auto",
        },

        // Hide the menu after clicking on some
        // element in it
        autoClose: {
            type: Boolean,
            default: true,
        },

    }
})
export class ButtonDropdown extends Vue {
    text: string;
    bClass: any;
    position: string;
    autoClose: boolean;
    open: boolean;
    id: string;
    dropup: boolean;

    data() {
        return {
            open: false,
            // generate an unique id for this dropdown
            id: "btn-group-" + Math.random().toString(36).substr(2, 9),
            dropup: false,
        };
    }
    
    mounted() {
        var self = this;
        // close the popup if we click elsewhere
        // from the target search if any parent has the id
        $(document).on('click', function (event) {
            if (self.open === false)
                return;
            if ($(event.target).closest('#' + self.id).length === 0) {
                self.open = false;
            }
        });
    }

    toggle() {
        this.open = !this.open;
        if (this.open === true) {
            var self = this;
            this.$nextTick(function () {
                switch (this.position) {
                    case "up":
                        this.dropup = true;
                        break;
                    case "down":
                        this.dropup = false;
                        break;
                    case "auto":
                        var button = $(self.$el),
                            bottomPosition = button.offset().top + button.height(),
                            menuHeight = button.find('.dropdown-menu').height(),
                            windowHeight = $(window).height();
                        if (menuHeight > windowHeight - bottomPosition) {
                            this.dropup = true;
                        } else {
                            this.dropup = false;
                        }
                        break;
                }
            });
        }
    }

    itemSelected() {
        if (this.autoClose) {
            this.toggle();
        }
    }

}

export function register() { Vue.component('button-dropdown', ButtonDropdown); }
