import * as $ from 'jquery';
import { store } from './app';

export class WSHandler {
  host: string;
  conn: WebSocket;
  connected: JQueryDeferred<{}>;
  connecting: boolean;
  disconnected: JQueryDeferred<{}>;
  msgHandlers: { [namespace: string]: ((msg: string) => void)[]; };
  discHandlers: (() => void)[];
  connHandlers: (() => void)[];

  constructor () {
    this.host = location.host;
    this.conn = null;
    this.connected = null;
    this.disconnected = null;
    this.msgHandlers = {};
    this.discHandlers = [];
    this.connHandlers = [];
  }

  connect() {
    let self = this;

    if (this.conn && this.conn.readyState === WebSocket.OPEN) {
      return;
    }

    this._connect();
  }

  _connect() { 
    let self = this;

    this.connected = $.Deferred();
    this.connected.then(function () {
      self.connHandlers.forEach(function (callback) {
        callback();
      });
    });
    this.disconnected = $.Deferred();
    this.disconnected.then(function () {
      self.discHandlers.forEach(function (callback) {
        callback();
      });
    });
    this.connecting = true;

    this.conn = new WebSocket('ws://' + this.host + '/ws');
    this.conn.onopen = function () {
      self.connecting = false;
      self.connected.resolve(true);
    };
    this.conn.onclose = function () {
      // connection closed after a succesful connection
      if (self.connecting === false) {
        store.commit('addNotification', { message: 'Connection lost', type: 'danger' });
        store.commit('logout');
        self.disconnected.resolve(true);
        // client never succeed to connect in the first place
      } else {
        self.connecting = false;
        self.connected.reject(false);
      }
    };
    this.conn.onmessage = function (r) {
      let msg = JSON.parse(r.data);
      if (self.msgHandlers[msg.Namespace]) {
        self.msgHandlers[msg.Namespace].forEach(function (callback) {
          callback(msg);
        });
      }
    };

    return self.connected;
  }

  addMsgHandler(namespace: string, callback: (msg: string) => void) {
    if (!this.msgHandlers[namespace]) {
      this.msgHandlers[namespace] = [];
    }
    this.msgHandlers[namespace].push(callback);
  }

  addConnectHandler(callback: () => void) {
    this.connHandlers.push(callback);
    if (this.connected !== null) {
      this.connected.then(function () {
        callback();
      });
    }
  }

  delConnectHandler(callback: () => void) {
    this.connHandlers.splice(
      this.connHandlers.indexOf(callback), 1);
  }

  addDisconnectHandler(callback: () => void) {
    this.discHandlers.push(callback);
    if (this.disconnected !== null) {
      this.disconnected.then(function () {
        callback();
      });
    }
  }

  send(msg: any) {
    this.conn.send(JSON.stringify(msg));
  }

}