import Vue from 'vue';
import { Component, Watch, Prop } from 'vue-property-decorator';

@Component({ template: require('./notification.html') })
class Notification extends Vue {
  @Prop()
  notification: { title: string, timeout: boolean, delay: number, type: string };
  timeout: number;

  mounted() {
    let self = this;
    if (self.notification.timeout === false)
      return;
    this.timeout = window.setTimeout(function () {
      self.$store.commit('removeNotification', self.notification);
    }, self.notification.delay || 2000);
  }

  get css() {
    return 'alert-' + this.notification.type;
  }

  close() {
    if (this.timeout) {
      clearInterval(this.timeout);
    }
    this.$store.commit('removeNotification', this.notification);
  }
};

@Component({
  components: {
    notification: Notification,
  },
  template: require('./notifications.html')
})
class Notifications extends Vue {

  get notifications() {
    return this.$store.getters.notifications;
  }
}

export interface NotifOptions {
  message: string;
}

export interface NotificationMixinContract extends Vue {
  $notify: (options: NotifOptions) => void;
  $error:  (options: NotifOptions) => void;
  $success:  (options: NotifOptions) => void;
}

export const notificationMixin = {
  methods: {
    $notify: function(this: NotificationMixinContract, options) {
      this.$store.commit('addNotification', Object.assign({
        type: 'info',
        title: '',
        timeout: true,
        delay: 2000,
      }, options));
    },

    $error: function(this: NotificationMixinContract, options) {
      this.$store.commit('addNotification', Object.assign({
        type: 'danger',
        title: '',
        timeout: true,
        delay: 3000,
      }, options));
    },

    $success: function (this: NotificationMixinContract, options) {
      this.$store.commit('addNotification', Object.assign({
        type: 'success',
        title: '',
        timeout: true,
        delay: 2000,
      }, options));
    }
  }
};

export function register() { Vue.component('notifications', Notifications); }