/*
 * WebFeed
 * MK4 by Xynium — GNOME 49 ES Modules
 * Soup3
 */

// GI imports (ES modules for GNOME 45+)
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';

// GNOME Shell UI imports
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Extension base class and i18n
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Local modules
import {REXML} from './jsxml.js';
import {RssParser} from './rss.js';
import {AtomParser} from './atom.js';

// GSettings keys
const RSS_FEEDS_LIST_KEY = 'rss-feeds-list';
const UPDATE_INTERVAL_KEY = 'update-interval';
const ITEMS_VISIBLE_KEY = 'items-visible';
const DELETE_AFTER = 'delete-after';
const OKFORNOTIF = 'okfornotif';
const DURHOTISHOT = 'durationhotitem';
const DLYFORRX = 'delayforreceive';

const _MS_PER_HOUR = 1000 * 60 * 60;

// Common HTML named entities for decoding feed titles
const _HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
    '&laquo;': '«', '&raquo;': '»',
    '&ndash;': '–', '&mdash;': '—',
    '&hellip;': '…', '&copy;': '©',
};

/**
 * Decode HTML entities in feed text (named, decimal, hex) and strip tags.
 * RSS/Atom feeds often contain encoded characters like &#8217; or &amp;
 */
function _decodeHtml(str) {
    if (!str) return str;
    let result = str.replace(/&[a-zA-Z]+;/g, m => _HTML_ENTITIES[m] ?? m);
    result = result.replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
    result = result.replace(/<[^>]+>/g, '');
    return result;
}

const WebFeedIndicator = GObject.registerClass(
class WebFeedIndicator extends PanelMenu.Button {

    _init(ext) {
        super._init(0);

        // Store extension reference for settings, path and openPreferences()
        this._ext = ext;
        this._settings = ext.getSettings();
        this._dir = ext.path;

        this.httpSession = null;
        this._startIndex = 0;
        this.hotIndex = 0;
        this._feedsArray = [];
        this._rxAsync = [];
        this._secu = 0;

        // Persistent notification source — shows as "WebFeed" in GNOME notifications
        this._notifSource = new MessageTray.Source({
            title: 'WebFeed',
            icon: Gio.icon_new_for_string(this._dir + '/rss_red.png'),
        });
        Main.messageTray.add(this._notifSource);

        this.topBox = new St.BoxLayout();
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(this._dir + '/rss_green.png'),
            style_class: 'webfeed-icon-size',
        });
        this.topBox.add_child(this.icon);
        this.add_child(this.topBox);

        // Menu
        this.feedsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this.feedsSection);

        // Time line
        this.TimeMenu = new PopupMenu.PopupBaseMenuItem({reactive: false});

        let customTimeBox = new St.BoxLayout({
            style_class: 'webfeed-time-box',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
            x_expand: true,
        });

        this.lastUpdateTime = new St.Button({label: _('Last update') + ': --:--'});
        customTimeBox.add_child(this.lastUpdateTime);
        this.TimeMenu.add_child(customTimeBox);
        this.menu.addMenuItem(this.TimeMenu);

        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(separator);

        // Bottom button bar
        this._buttonMenu = new PopupMenu.PopupBaseMenuItem({reactive: false});

        let customButtonBox = new St.BoxLayout({
            style_class: 'webfeed-button-box',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
        });

        let prevBtn = this._createRoundButton('go-previous');
        prevBtn.connect('clicked', () => this._onPreviousBtnClicked());
        customButtonBox.add_child(prevBtn);

        let nextBtn = this._createRoundButton('go-next');
        nextBtn.connect('clicked', () => this._onNextBtnClicked());
        customButtonBox.add_child(nextBtn);

        let reloadBtn = this._createRoundButton('view-refresh');
        reloadBtn.connect('clicked', () => this._reloadRssFeeds());
        customButtonBox.add_child(reloadBtn);

        let settingsBtn = this._createRoundButton('emblem-system');
        settingsBtn.connect('clicked', () => this._ext.openPreferences());
        customButtonBox.add_child(settingsBtn);

        this._buttonMenu.add_child(customButtonBox);
        this.menu.addMenuItem(this._buttonMenu);

        try {
            this._browser = Gio.app_info_get_default_for_uri_scheme('http').get_executable();
            console.log('Browser: ' + this._browser);
        } catch (err) {
            console.log(err + ' (get default browser error)');
        }

        this.lastUpdateTime.set_label(_('Last update') + ': ' + new Date().toLocaleTimeString());
        this._reloadRssFeeds();
    }

    _createRoundButton(iconName) {
        let button = new St.Button();
        button.child = new St.Icon({
            icon_name: iconName,
            style_class: 'webfeed-button-action',
        });
        return button;
    }

    _onPreviousBtnClicked() {
        this._startIndex -= this._settings.get_int(ITEMS_VISIBLE_KEY);
        if (this._startIndex < 0)
            this._startIndex = 0;
        this._refreshMenuLst();
    }

    _onNextBtnClicked() {
        if (this._startIndex + this._settings.get_int(ITEMS_VISIBLE_KEY) < this._settings.get_strv(RSS_FEEDS_LIST_KEY).length) {
            this._startIndex += this._settings.get_int(ITEMS_VISIBLE_KEY);
            this._refreshMenuLst();
        }
    }

    _getParametersAsJson(url) {
        if (url.indexOf('?') === -1)
            return '{}';

        let urlParams = url.substring(url.indexOf('?') + 1);
        let params = urlParams.split('&');

        let jsonObj = '{';
        for (let i = 0; i < params.length; i++) {
            let pair = params[i].split('=');
            jsonObj += '"' + pair[0] + '":"' + pair[1] + '"';
            if (i !== params.length - 1)
                jsonObj += ',';
        }
        jsonObj += '}';
        return jsonObj;
    }

    // Fetch all RSS/Atom feeds and schedule next update
    _reloadRssFeeds() {
        console.log('Reload all Feeds');
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        if (this._settings.get_strv(RSS_FEEDS_LIST_KEY).length !== 0) {
            this._feedsArray = [];
            this._rxAsync = [];
            let feeds = this._settings.get_strv(RSS_FEEDS_LIST_KEY);
            if (feeds) {
                for (let i = 0; i < feeds.length; i++) {
                    let url = feeds[i];
                    let jsonObj = this._getParametersAsJson(url);

                    if (url.indexOf('?') !== -1)
                        url = url.substring(0, url.indexOf('?'));

                    this._httpGetRequestAsync(url, JSON.parse(jsonObj), i);
                    this._rxAsync[i] = 1;
                }
            }
            this._wtforresptmr = GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE, 100, this._wtforresp.bind(this));
            this._secu = 0;
        }

        if (this._settings.get_int(UPDATE_INTERVAL_KEY) > 0) {
            this._timeout = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT_IDLE,
                this._settings.get_int(UPDATE_INTERVAL_KEY) * 60,
                this._reloadRssFeeds.bind(this)
            );
        }
        return GLib.SOURCE_REMOVE;
    }

    // Poll timer: wait for all HTTP responses (100ms interval)
    _wtforresp() {
        let strNoResp = '';
        if (this._wtforresptmr) {
            GLib.source_remove(this._wtforresptmr);
            this._wtforresptmr = null;
        }
        let allz = false;
        try {
            if (this._secu++ > this._settings.get_int(DLYFORRX))
                throw new Error('ERROR: Http problem');

            allz = this._rxAsync.every(value => value === 0);
            if (!allz) {
                this._wtforresptmr = GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE, 100, this._wtforresp.bind(this));
                return GLib.SOURCE_REMOVE;
            }
        } catch (error) {
            console.log(error);
            let feeds = this._settings.get_strv(RSS_FEEDS_LIST_KEY);
            for (let i = 0; i < feeds.length; i++) {
                if (this._rxAsync[i] === 1)
                    strNoResp += '\n' + feeds[i] + _(' has not responded ');
            }
        }
        console.log('all response in ' + this._secu / 10 + ' s');
        this._refreshMenuLst();
        this.lastUpdateTime.set_label(_('Last update') + ': ' + new Date().toLocaleTimeString() + strNoResp);
        return GLib.SOURCE_REMOVE;
    }

    // Async HTTP GET via Soup3
    _httpGetRequestAsync(url, params, position) {
        if (this.httpSession === null)
            this.httpSession = new Soup.Session();

        let message = Soup.Message.new_from_encoded_form('GET', url, Soup.form_encode_hash(params));
        this.httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            if (message.get_status() === Soup.Status.OK) {
                let bytes = session.send_and_read_finish(result);
                if (bytes) {
                    let decoder = new TextDecoder('utf-8');
                    let response = decoder.decode(bytes.get_data());
                    this._onDownload(response, position);
                } else {
                    this._rxAsync[position] = 0;
                }
            } else {
                this._rxAsync[position] = 0;
            }
        });
    }

    // Parse downloaded XML as RSS or Atom, decode HTML entities in titles
    _onDownload(responseData, position) {
        let xmlDoc = new REXML(responseData);
        let feedParser = null;

        if (xmlDoc.rootElement.name.toLowerCase().slice(0, 3) === 'rss')
            feedParser = new RssParser(xmlDoc.rootElement);

        if (xmlDoc.rootElement.name.toLowerCase().slice(0, 4) === 'feed')
            feedParser = new AtomParser(xmlDoc.rootElement);

        if (feedParser === null) {
            console.log('Bad XML nor RSS nor ATOM');
            this._rxAsync[position] = 0;
            return;
        }

        if (feedParser.Items.length > 0) {
            let feed = {
                Title: _decodeHtml(feedParser.Title),
                HttpLink: feedParser.HttpLink,
                PublishDate: feedParser.PublishDate,
                Items: [],
            };

            for (let i = 0; i < feedParser.Items.length; i++) {
                feed.Items.push({
                    Title: _decodeHtml(feedParser.Items[i].Title),
                    HttpLink: feedParser.Items[i].HttpLink,
                    PublishDate: feedParser.Items[i].PublishDate,
                });
            }
            this._feedsArray[position] = feed;
            this._rxAsync[position] = 0;
        } else {
            console.log('Bad XML or no item in it');
            this._rxAsync[position] = 0;
        }
    }

    // Rebuild popup menu with feed items, sorted by date
    _refreshMenuLst() {
        let counter = 0;
        this.feedsSection.removeAll();
        this._eraseHotItem();

        for (let i = this._startIndex; i < this._feedsArray.length; i++) {
            if (this._feedsArray[i] && this._feedsArray[i].Items) {
                let feedDate = this._isoDateParser(this._feedsArray[i].PublishDate);
                // Fallback: if feed-level date is missing/invalid, use newest item date
                if (isNaN(feedDate.getTime()) && this._feedsArray[i].Items.length > 0) {
                    for (let k = 0; k < this._feedsArray[i].Items.length; k++) {
                        const itemDate = this._isoDateParser(this._feedsArray[i].Items[k].PublishDate);
                        if (!isNaN(itemDate.getTime()) && itemDate > feedDate || isNaN(feedDate.getTime()))
                            feedDate = itemDate;
                    }
                }
                let old = isNaN(feedDate.getTime()) ? 0 : (new Date() - feedDate) / _MS_PER_HOUR;
                if (old > this._settings.get_int(DELETE_AFTER))
                    continue;
                if (this.hotIndex < 1)
                    this._warmItem();

                // Sort items by publish date, newest first
                const sortedItems = this._feedsArray[i].Items.slice().sort((a, b) => {
                    const da = this._isoDateParser(a.PublishDate);
                    const db = this._isoDateParser(b.PublishDate);
                    return db - da;
                });

                let nItems = sortedItems.length;
                let timeStr = isNaN(feedDate.getTime()) ? '' : _('( ') + old.toFixed(1) + _('H ago) ');
                let subMenu = new PopupMenu.PopupSubMenuMenuItem(
                    timeStr + this._feedsArray[i].Title + ' (' + nItems + ') :'
                );

                for (let j = 0; j < nItems; j++) {
                    const item = sortedItems[j];
                    old = (new Date() - this._isoDateParser(item.PublishDate)) / _MS_PER_HOUR;
                    if (old > this._settings.get_int(DELETE_AFTER))
                        continue;
                    if (old < this._settings.get_int(DURHOTISHOT) / 60 && this.hotIndex < 2)
                        this._hotItem(item.Title);

                    let menuItem = new PopupMenu.PopupMenuItem(
                        _('( ') + old.toFixed(1) + _('H ago) ') + item.Title
                    );
                    subMenu.menu.addMenuItem(menuItem);

                    // Open link in default browser on click
                    menuItem.connect('activate', () => {
                        console.log('Opening browser: ' + this._browser + ' with link: ' + item.HttpLink);
                        try {
                            let ctx = global.create_app_launch_context(0, -1);
                            let appInfo = Gio.AppInfo.create_from_commandline(
                                this._browser + ' ' + item.HttpLink,
                                null,
                                Gio.AppInfoCreateFlags.NONE
                            );
                            appInfo.launch([], ctx);
                        } catch (err) {
                            console.log(err + ' (launch browser error)');
                        }
                    });
                }
                this.feedsSection.addMenuItem(subMenu);
            } else {
                let subMenu = new PopupMenu.PopupMenuItem(_('No data available'));
                this.feedsSection.addMenuItem(subMenu);
            }
            counter++;
            if (counter === this._settings.get_int(ITEMS_VISIBLE_KEY))
                break;
        }
    }

    _isoDateParser(datestr) {
        return new Date(datestr);
    }

    // Hot item: red icon + notification (item newer than durationhotitem threshold)
    _hotItem(strItm) {
        this.hotIndex = 2;
        this.topBox.remove_all_children();
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(this._dir + '/rss_red.png'),
            style_class: 'webfeed-icon-size',
        });
        this.topBox.add_child(this.icon);
        if (this._settings.get_boolean(OKFORNOTIF)) {
            const notification = new MessageTray.Notification({
                source: this._notifSource,
                title: 'WebFeed',
                body: strItm,
            });
            this._notifSource.addNotification(notification);
        }
    }

    // Warm state: yellow icon (feeds loaded, no hot items)
    _warmItem() {
        this.hotIndex = 1;
        this.topBox.remove_all_children();
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(this._dir + '/rss_yelow.png'),
            style_class: 'webfeed-icon-size',
        });
        this.topBox.add_child(this.icon);
    }

    // Default state: green icon (reset before each menu rebuild)
    _eraseHotItem() {
        this.hotIndex = 0;
        this.topBox.remove_all_children();
        this.icon = new St.Icon({
            gicon: Gio.icon_new_for_string(this._dir + '/rss_green.png'),
            style_class: 'webfeed-icon-size',
        });
        this.topBox.add_child(this.icon);
    }

    // Cleanup timers on destroy
    destroy() {
        if (this._wtforresptmr) {
            GLib.source_remove(this._wtforresptmr);
            this._wtforresptmr = null;
        }
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        super.destroy();
    }
});

// Extension entry point (GNOME 45+ ES module pattern)
export default class WebFeedExtension extends Extension {
    enable() {
        this._indicator = new WebFeedIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
