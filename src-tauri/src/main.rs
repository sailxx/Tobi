// Tobi runs without a console window: Tobi is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tobi_lib::run()
}
