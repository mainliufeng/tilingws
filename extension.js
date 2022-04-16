/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const {Gio, Shell, Meta} = imports.gi;
const Main = imports.ui.main;
const Me = imports.misc.extensionUtils.getCurrentExtension();

function getSettings () {
    let GioSSS = Gio.SettingsSchemaSource;
    let schemaSource = GioSSS.new_from_directory(
        Me.dir.get_child("schemas").get_path(),
        GioSSS.get_default(),
        false
    );
    let schemaObj = schemaSource.lookup(
        'org.gnome.shell.extensions.glayout', true);
    if (!schemaObj) {
        throw new Error('cannot find schemas');
    }
    return new Gio.Settings({ settings_schema : schemaObj });
}

function _is_tiling(window) {
    return !window.is_hidden() && !window.maximized_horizontally && !window.maximized_horizontally && window.allows_resize()
}

class TilingWorkspace {
    constructor(ws) {
        // work space manager
        this.wsm = global.workspace_manager
        // work space
        this.ws = ws

        // tiling windows
        this.t_windows = []

        // master window fact
        this.mw_fact = 0.5

        this.y_offset = 80
    }

    layout() {
        var t_windows = this.ws.list_windows().filter(_is_tiling)

        // no window
        if (t_windows.length == 0) { 
            this.t_windows = []
            return
        }

        var t_window_id_set = new Set(t_windows.map(window => window.get_id()))
        this.t_windows = this.t_windows.filter(window => t_window_id_set.has(window.get_id()))
        let this_t_window_id_set = new Set(this.t_windows.map(window => window.get_id()))
        t_windows.forEach(window => {
            if (!this_t_window_id_set.has(window.get_id())) {
                this.t_windows.push(window)
            }
        });
        print('tiling window count: ', this.t_windows.length)
    }

    relocate() {
        // no window
        if (this.t_windows.length == 0) {
            return
        }

        let area = this.ws.get_work_area_all_monitors()

        // 1 window
        if (this.t_windows.length == 1) {
            this.t_windows[0].move_frame(false, 0, 0 + this.y_offset)
            this.t_windows[0].move_resize_frame(false, 0, 0 + this.y_offset, area.width, area.height)
            return
        }

        // >1 window
        let master_width = Math.floor(area.width * this.mw_fact)
        this.t_windows[0].move_frame(false, 0, 0 + this.y_offset)
        this.t_windows[0].move_resize_frame(false, 0, 0 + this.y_offset, master_width, area.height)

        let stack_count = this.t_windows.length - 1
        let stack_width = area.width - master_width
        let stack_height = Math.floor(area.height / stack_count)

        for (var i=1; i<this.t_windows.length; i++) {
            this.t_windows[i].move_frame(false, master_width, (i - 1) * stack_height + this.y_offset)
            this.t_windows[i].move_resize_frame(false, master_width, (i - 1) * stack_height + this.y_offset, stack_width, stack_height)
            log('locate stack', i - 1, master_width, (i - 1) * stack_height + this.y_offset, stack_width, stack_height)
        }
    }

    focus_relative(offset) {
        var windows = []
        this.t_windows.forEach(window => {
            windows.push(window)
        });

        let this_t_window_id_set = new Set(this.t_windows.map(window => window.get_id()))
        this.ws.list_windows().forEach(window => {
            if (!this_t_window_id_set.has(window.get_id())) {
                windows.push(window)
            }
        })

        var current_window_index = 0
        while (current_window_index < windows.length) {
            let window = windows[current_window_index]
            if (window.has_focus()) {
                break
            }
            current_window_index++
        }

        var target_window_index = current_window_index + offset 
        if (target_window_index < 0) {
            target_window_index = windows.length + target_window_index
        } else if (target_window_index >= windows.length) {
            target_window_index = target_window_index - windows.length
        }

        if (target_window_index >=0 && target_window_index < windows.length) {
            let target_window = windows[target_window_index]
            target_window.focus(global.display.get_current_time())
            target_window.activate(global.display.get_current_time())
        }
    }

    swap_master() {
        var f_window_index = -1
        for (var i=0; i<this.t_windows.length; i++) {
            if (this.t_windows[i].has_focus()) {
                f_window_index = i
                break
            }
        }

        if (f_window_index == -1) {
            return
        }

        if (f_window_index != 0) {
            let new_master = this.t_windows[f_window_index]
            this.t_windows[f_window_index] = this.t_windows[0]
            this.t_windows[0] = new_master
        } else if (this.t_windows.length > 1) {
            let new_master = this.t_windows[1]
            this.t_windows[1] = this.t_windows[0]
            this.t_windows[0] = new_master
        }

        this.relocate()
    }

    increase_mw_fact() {
        this.mw_fact += 0.1
        if (this.mw_fact > 0.9) {
            this.mw_fact = 0.9
        }
        this.relocate()
    }

    decrease_mw_fact() {
        this.mw_fact -= 0.1
        if (this.mw_fact < 0.1) {
            this.mw_fact = 0.1
        }
        this.relocate()
    }

}

class Extension {
    constructor() {
        this.tws_map = new Map()
    }

    get_tws(workspace) {
        var tws = this.tws_map[workspace.index()]
        if (!tws) {
            tws = new TilingWorkspace(workspace)
            this.tws_map[workspace.index()] = tws
        }
        return tws
    }

    enable() {
        // Shell.ActionMode.NORMAL
        // Shell.ActionMode.OVERVIEW
        // Shell.ActionMode.LOCK_SCREEN
        // Shell.ActionMode.ALL
        let mode = Shell.ActionMode.ALL;
        // Meta.KeyBindingFlags.NONE
        // Meta.KeyBindingFlags.PER_WINDOW
        // Meta.KeyBindingFlags.BUILTIN
        // Meta.KeyBindingFlags.IGNORE_AUTOREPEAT
        let flag = Meta.KeyBindingFlags.NONE;
        let settings = getSettings();

        Main.wm.addKeybinding("focus-up", settings, flag, mode, () => {
            let tws = this.get_tws(global.workspace_manager.get_active_workspace())
            tws.focus_relative(-1)
        });
        Main.wm.addKeybinding("focus-down", settings, flag, mode, () => {
            let tws = this.get_tws(global.workspace_manager.get_active_workspace())
            tws.focus_relative(1)
        });
        Main.wm.addKeybinding("switch-master", settings, flag, mode, () => {
            let tws = this.get_tws(global.workspace_manager.get_active_workspace())
            tws.swap_master()
        });
        Main.wm.addKeybinding("increase-mw-fact", settings, flag, mode, () => {
            let tws = this.get_tws(global.workspace_manager.get_active_workspace())
            tws.increase_mw_fact()
        });
        Main.wm.addKeybinding("decrease-mw-fact", settings, flag, mode, () => {
            let tws = this.get_tws(global.workspace_manager.get_active_workspace())
            tws.decrease_mw_fact()
        });

        for (var i=0; i<global.workspace_manager.get_n_workspaces(); i++) {
            let ws = global.workspace_manager.get_workspace_by_index(i)
            ws.connect('window-added', (window) => {
                let tws = this.get_tws(ws)
                tws.layout()
                tws.relocate()
            });
            ws.connect('window-removed', (window) => {
                let tws = this.get_tws(ws)
                tws.layout()
                tws.relocate()
            });
        }
    }

    disable() {
        Main.wm.removeKeybinding("focus-up");
        Main.wm.removeKeybinding("focus-down");
        Main.wm.removeKeybinding("switch-master");
    }
}

function init() {
    return new Extension();
}
