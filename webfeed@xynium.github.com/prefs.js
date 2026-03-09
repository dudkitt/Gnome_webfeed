/*
 * WebFeed extension for GNOME Shell
 * Xynium — GNOME 49 ES Modules / Adw
 */

// GI imports (GTK4 + libadwaita for preferences UI)
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

// Preferences base class and i18n (GNOME 45+)
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// GSettings keys
const RSS_FEEDS_LIST_KEY = 'rss-feeds-list';
const UPDATE_INTERVAL_KEY = 'update-interval';
const ITEMS_VISIBLE_KEY = 'items-visible';
const DELETE_AFTER = 'delete-after';
const OKFORNOTIF = 'okfornotif';
const DURHOTISHOT = 'durationhotitem';
const DLYFORRX = 'delayforreceive';

// Preferences window using Adw.PreferencesWindow (GNOME 45+ pattern)
export default class WebFeedPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- Page: General ---
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // --- Group: Timing ---
        const timingGroup = new Adw.PreferencesGroup({
            title: _('Timing'),
        });
        page.add(timingGroup);

        // Update interval
        const updateRow = new Adw.ActionRow({
            title: _('Update interval (minutes)'),
            subtitle: _('0 = manual only'),
        });
        const updateSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 0, upper: 1440, step_increment: 1, page_increment: 10}),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(UPDATE_INTERVAL_KEY, updateSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        updateRow.add_suffix(updateSpin);
        timingGroup.add(updateRow);

        // Waiting delay for response
        const rxDlyRow = new Adw.ActionRow({
            title: _('Waiting delay for response (seconds)'),
        });
        const rxDlySpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 1, upper: 360, step_increment: 1, page_increment: 10}),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(DLYFORRX, rxDlySpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        rxDlyRow.add_suffix(rxDlySpin);
        timingGroup.add(rxDlyRow);

        // --- Group: Display ---
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
        });
        page.add(displayGroup);

        // Items visible per page
        const itemsRow = new Adw.ActionRow({
            title: _('RSS sources per page'),
        });
        const itemsSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 1, upper: 50, step_increment: 1, page_increment: 10}),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(ITEMS_VISIBLE_KEY, itemsSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        itemsRow.add_suffix(itemsSpin);
        displayGroup.add(itemsRow);

        // Erase after (hours)
        const eraseRow = new Adw.ActionRow({
            title: _('Erase after (hours)'),
        });
        const eraseSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 1, upper: 100, step_increment: 1, page_increment: 10}),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(DELETE_AFTER, eraseSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        eraseRow.add_suffix(eraseSpin);
        displayGroup.add(eraseRow);

        // --- Group: Notifications ---
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
        });
        page.add(notifGroup);

        // Duration of news (minutes)
        const durRow = new Adw.ActionRow({
            title: _('Duration of news (minutes)'),
        });
        const durSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 1, upper: 360, step_increment: 1, page_increment: 10}),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(DURHOTISHOT, durSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        durRow.add_suffix(durSpin);
        notifGroup.add(durRow);

        // Notification switch
        const notifRow = new Adw.ActionRow({
            title: _('Notification on news'),
        });
        const notifSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(OKFORNOTIF, notifSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifRow.add_suffix(notifSwitch);
        notifGroup.add(notifRow);

        // --- Page: Feeds ---
        const feedsPage = new Adw.PreferencesPage({
            title: _('Feeds'),
            icon_name: 'application-rss+xml-symbolic',
        });
        window.add(feedsPage);

        const feedsGroup = new Adw.PreferencesGroup({
            title: _('Feed sources'),
        });
        feedsPage.add(feedsGroup);

        // Use Gtk.ListBox for reliable add/remove of feed rows
        // (Adw.PreferencesGroup.remove() does not work for dynamic rows)
        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        feedsGroup.add(listBox);

        // Rebuild feed list from settings; remove_all() clears the ListBox
        const _rebuildFeedRows = () => {
            listBox.remove_all();

            const feeds = settings.get_strv(RSS_FEEDS_LIST_KEY);
            for (let i = 0; i < feeds.length; i++) {
                // activatable: false — prevents row from capturing button clicks
                const row = new Adw.ActionRow({title: feeds[i], activatable: false});

                const editBtn = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                editBtn.connect('clicked', () => {
                    this._showEditDialog(window, settings, i, _rebuildFeedRows);
                });

                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                delBtn.connect('clicked', () => {
                    let f = settings.get_strv(RSS_FEEDS_LIST_KEY);
                    f.splice(i, 1);
                    settings.set_strv(RSS_FEEDS_LIST_KEY, f);
                    _rebuildFeedRows();
                });

                row.add_suffix(editBtn);
                row.add_suffix(delBtn);
                listBox.append(row);
            }
        };

        _rebuildFeedRows();

        // Add button
        const addGroup = new Adw.PreferencesGroup();
        const addBtn = new Gtk.Button({
            label: _('Add Feed'),
            icon_name: 'list-add-symbolic',
            css_classes: ['suggested-action'],
            halign: Gtk.Align.CENTER,
        });
        addBtn.connect('clicked', () => {
            this._showAddDialog(window, settings, _rebuildFeedRows);
        });
        addGroup.add(addBtn);
        feedsPage.add(addGroup);
    }

    // Modal dialog for adding a new feed URL
    _showAddDialog(parentWindow, settings, rebuild) {
        const dialog = new Adw.MessageDialog({
            transient_for: parentWindow,
            heading: _('New Feed source'),
            body: _('Enter feed URL:'),
        });

        const entry = new Gtk.Entry({
            placeholder_text: 'https://example.com/feed.xml',
            width_chars: 50,
        });
        dialog.set_extra_child(entry);

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('add');
        dialog.set_close_response('cancel');

        entry.connect('changed', () => {
            dialog.set_response_enabled('add', entry.get_text().length > 0);
        });
        dialog.set_response_enabled('add', false);

        // Save text before destroy() — GTK may invalidate entry on close
        dialog.connect('response', (_dlg, response) => {
            const text = entry.get_text();
            dialog.destroy();
            if (response === 'add' && text.length > 0) {
                let feeds = settings.get_strv(RSS_FEEDS_LIST_KEY);
                feeds.push(text);
                settings.set_strv(RSS_FEEDS_LIST_KEY, feeds);
                rebuild();
            }
        });

        dialog.present();
    }

    // Modal dialog for editing an existing feed URL
    _showEditDialog(parentWindow, settings, index, rebuild) {
        const feeds = settings.get_strv(RSS_FEEDS_LIST_KEY);
        const dialog = new Adw.MessageDialog({
            transient_for: parentWindow,
            heading: _('Edit Feed source'),
            body: _('Edit feed URL:'),
        });

        const entry = new Gtk.Entry({
            text: feeds[index],
            width_chars: 50,
        });
        dialog.set_extra_child(entry);

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('save', _('Save'));
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('save');
        dialog.set_close_response('cancel');

        entry.connect('changed', () => {
            dialog.set_response_enabled('save', entry.get_text().length > 0);
        });

        // Save text before destroy() — GTK may invalidate entry on close
        dialog.connect('response', (_dlg, response) => {
            const text = entry.get_text();
            dialog.destroy();
            if (response === 'save' && text.length > 0) {
                let f = settings.get_strv(RSS_FEEDS_LIST_KEY);
                f[index] = text;
                settings.set_strv(RSS_FEEDS_LIST_KEY, f);
                rebuild();
            }
        });

        dialog.present();
    }
}
