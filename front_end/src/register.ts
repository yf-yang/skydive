import * as autocomplete from './components/autocomplete/autocomplete';
import * as buttonDropdown from './components/button-dropdown/button-dropdown';
import * as buttonState from './components/button-state/button-state';
import * as captureForm from './components/capture-form/capture-form';
import * as captureList from './components/capture-list/capture-list';
import * as dynamicTable from './components/dynamic-table/dynamic-table';
import * as flowTable from './components/flow-table/flow-table';
import * as injectForm from './components/inject-form/inject-form';
import * as nodeSelector from './components/node-selector/node-selector';
import * as notifications from './components/notifications/notifications';
import * as objectDetail from './components/object-detail/object-detail';
import * as slider from './components/slider/slider';
import * as statisticTables from './components/statistics-table/statistics-table';
import * as tabs from './components/tabs/tabs';


export function register() {
    autocomplete.register();
    buttonDropdown.register();
    buttonState.register();
    captureForm.register();
    captureList.register();
    dynamicTable.register();
    flowTable.register();
    injectForm.register();
    nodeSelector.register();
    notifications.register();
    objectDetail.register();
    slider.register();
    statisticTables.register();
    tabs.register();
}