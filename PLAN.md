Dailies is an Uebersicht widget for tracking daily habits. It is easily configurable and low-maintenance.

Dailies are represented via a grid. The column represents the date with the row represents any particular daily habit. There are no cell borders. Each grid cell contains a dot which changes its color smoothly upon tapping and adds a nice "success" animation. The number of columns shown is user-configurable.

User-config is handled via a JSON file (possibly: yaml) deposited in the same folder as the widget code. It is loaded upon initial rendering of the widget. 

The Dailies widget is a minimalist, functional but pretty, rounded card living at a user-configurable corner of the screen. The width should vary based on the amount of columns specified, vice versa with the height and number of habits.

```json
{
    "n_col": 14,
    "show_success_animation": true,
    "location": "bottom_left",
    "habits": [
        "go to sleep on time"
    ]
}
```