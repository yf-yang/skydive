import * as $ from 'jquery';
import Vue from 'vue';
import Component from 'vue-class-component';
import { NotifOptions, NotificationMixinContract } from './components/notifications/notifications';

export interface ApiMixinContract extends Vue {
  $topologyQuery: (query: string) => JQueryPromise<any>;
  $captureList: () => JQueryPromise<any>;
  $captureCreate: (query: string, name: string, desc: string, bpf: string) => JQueryPromise<any>;
  $captureDelete: (uuid: string) => JQueryPromise<any>;
}


export const apiMixin = {
  methods: {

    $topologyQuery: function (this: ApiMixinContract, gremlinQuery: string) {
      return $.ajax({
        dataType: 'json',
        url: '/api/topology',
        data: JSON.stringify({ 'GremlinQuery': gremlinQuery }),
        contentType: 'application/json; charset=utf-8',
        method: 'POST',
      })
        .then(function (data) {
          if (data === null)
            return [];
          // Result can be [Node] or [[Node, Node]]
          if (data.length > 0 && data[0] instanceof Array)
            data = data[0];
          return data;
        });
    },

    $captureList: function (this: NotificationMixinContract) {
      let self = this;
      return $.ajax({
        dataType: 'json',
        url: '/api/capture',
        contentType: 'application/json; charset=utf-8',
        method: 'GET',
      })
        .fail(function (e) {
          self.$error({ message: 'Capture list error: ' + e.responseText });
          return e;
        });
    },

    $captureCreate: function (this: NotificationMixinContract, query: string, name: string, description: string, bpf: string) {
      let self = this;
      return $.ajax({
        dataType: 'json',
        url: '/api/capture',
        data: JSON.stringify({
          GremlinQuery: query,
          Name: name || null,
          Description: description || null,
          BPFFilter: bpf || null
        }),
        contentType: 'application/json; charset=utf-8',
        method: 'POST',
      })
        .then(function (data) {
          self.$success({ message: 'Capture created' });
          return data;
        })
        .fail(function (e) {
          self.$error({ message: 'Capture create error: ' + e.responseText });
          return e;
        });
    },

  $captureDelete: function(this: NotificationMixinContract, uuid: string) {
      let self = this;
      return $.ajax({
        dataType: 'text',
        url: '/api/capture/' + uuid + '/',
        method: 'DELETE',
      })
        .fail(function (e) {
          self.$error({ message: 'Capture delete error: ' + e.responseText });
          return e;
        });
    }
  }
};

