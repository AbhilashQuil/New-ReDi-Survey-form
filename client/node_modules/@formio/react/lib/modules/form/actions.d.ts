export function clearFormError(name: any): {
    type: string;
    name: any;
};
export function resetForm(name: any): {
    type: string;
    name: any;
};
export function getForm(name: any, id?: string, done?: () => void): (dispatch: any, getState: any) => any;
export function saveForm(name: any, form: any, done?: () => void): (dispatch: any) => void;
export function deleteForm(name: any, id: any, done?: () => void): (dispatch: any) => any;
//# sourceMappingURL=actions.d.ts.map