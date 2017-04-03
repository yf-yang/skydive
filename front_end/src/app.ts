import * as $ from 'jquery';
import 'jquery-ui';
import 'bootstrap/dist/js/bootstrap';

import Vue from 'vue';
import { Component, Watch, Prop } from 'vue-property-decorator';
import VueRouter from 'vue-router';
import Vuex from 'vuex';


import { WSHandler } from './websocket';
import { apiMixin, ApiMixinContract } from './api';

import { register } from './register';
import { notificationMixin, NotificationMixinContract, NotifOptions } from './components/notifications/notifications';
import { LoginComponent } from './components/login/login';
import { ConversationComponent } from './components/conversation/conversation';
import { DiscoveryComponent } from './components/discovery/discovery';
import { TopologyComponent } from './components/topology/topology';

export var websocket = new WSHandler();

Vue.use(Vuex);
Vue.use(VueRouter);
register();

export var store = new Vuex.Store({

  state: {
    logged: null,
    service: null,
    version: null,
    history: null,
    time: 0,
    currentNode: null,
    highlightedNodes: [],
    notifications: [],
  },

  getters: {

    timeHuman: function (state) {
      var d = new Date(state.time);
      return d.toLocaleTimeString();
    },

  },

  mutations: {

    history: function (state, support) {
      state.history = support;
    },

    time: function (state, time) {
      state.time = time;
    },

    login: function (state) {
      state.logged = true;
    },

    logout: function (state) {
      state.logged = false;
    },

    selected: function (state, node) {
      state.currentNode = node;
    },

    unselected: function (state) {
      state.currentNode = null;
    },

    highlight: function (state, id) {
      state.highlightedNodes.push(id);
    },

    unhighlight: function (state, id) {
      state.highlightedNodes = state.highlightedNodes.filter(function (_id) {
        return id !== _id;
      });
    },

    service: function (state, service) {
      state.service = service.charAt(0).toUpperCase() + service.slice(1);;
    },

    version: function (state, version) {
      state.version = version;
    },

    addNotification: function (state, notification) {
      if (state.notifications.length > 0 &&
        state.notifications.some(function (n) {
          return n.message === notification.message;
        })) {
        return;
      }
      state.notifications.push(notification);
    },

    removeNotification: function (state, notification) {
      state.notifications = state.notifications.filter(function (n) {
        return n !== notification;
      });
    },

  },

});

var routes = [
  { path: '/login', component: LoginComponent },
  {
    path: '/logout',
    component: {
      template: '<div></div>',
      created: function () {
        document.cookie = document.cookie + ';expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        this.$store.commit('logout');
      }
    }
  },
  { path: '/topology', component: TopologyComponent },
  // { path: '/conversation', component: ConversationComponent },
  // { path: '/discovery', component: DiscoveryComponent },
  { path: '*', redirect: '/topology' }
];

var router = new VueRouter({
  linkActiveClass: 'active',
  routes: routes
});

// if not logged, always route to /login
// if already logged don't route to /login
router.beforeEach(function (to, from, next) {
  if (store.state.logged === false && to.path !== '/login')
    next('/login');
  else if (store.state.logged === true && to.path == '/login')
    next(false);
  else
    next();
});

@Component({
  mixins: [notificationMixin, apiMixin],
  computed: Vuex.mapState(['service', 'version', 'logged']),
  router: router,
  store: store
})

class App extends Vue implements ApiMixinContract, NotificationMixinContract {

  service: string;
  version: string;
  logged: boolean;

  $topologyQuery: (q: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (q:string,n:string, d:string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;

  $notify: (options: NotifOptions) => void;
  $error:  (options: NotifOptions) => void;
  $success:  (options: NotifOptions) => void;

  interval: number;
  router = router;
  store = store;

  created() {
    var self = this;
    // global handler to detect authorization errors
    $(document).ajaxError(function (evt, e) {
      switch (e.status) {
        case 401:
          (self as NotificationMixinContract).$error({ message: 'Authentication failed' });
          self.$store.commit('logout');
          break;
      }
      return e;
    });

    this.checkAPI();
  }

  @Watch('logged')
  watchLogged(newVal:boolean) {
    var self = this;
    if (newVal === true) {
      websocket.connect();
      this.checkAPI();
      this.interval = window.setInterval(this.checkAPI, 5000);
      router.push('/topology');
      this.$success({ message: 'Connected' });
      // check if the Analyzer supports history
      this.$topologyQuery("G.At('-1m').V().Limit(1)")
        .then(function () {
          self.$store.commit('history', true);
        })
        .fail(function () {
          self.$store.commit('history', false);
        });
    } else {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      router.push('/login');
    }
  }

  checkAPI() {
    let self = this;
    return $.ajax({
      dataType: "json",
      url: '/api',
    })
      .then(function (r) {
        if (!self.$store.state.logged)
          self.$store.commit('login');
        if (self.$store.state.service != r.Service)
          self.$store.commit('service', r.Service);
        if (self.$store.state.version != r.Version)
          self.$store.commit('version', r.Version);
        return r;
      });
  }

}

var app = new App();


$(document).ready(function () {
  app.$mount('#app');
});
