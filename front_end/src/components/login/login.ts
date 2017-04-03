/* jshint multistr: true */
import Vue from 'vue';
import Component from 'vue-class-component';
import { notificationMixin } from '../notifications/notifications';

@Component({
  mixins: [notificationMixin],
  template: require('./login.html')
})
export class LoginComponent extends Vue {
  name = 'Login'

  login() {
    var self = this;
    $.ajax({
      url: '/login',
      data: $(this.$el).serialize(),
      method: 'POST',
    })
      .then(function (data) {
        self.$store.commit('login');
      });
  }
}
