/** 
 * debounce an event handler to avoid too many simultaneous calls
 * 
 * It gives back a function that may be called only once during the wait period.
 * Immediately or at the end of the period.
 * Each new call reset the timeout and so extend the wait period.
 * @param func the function to wrap
 * @param wait the timeout
 * @param immediate if true called the function is immediately executed otherwise 
 *    it is executed at the end of the debounce.
 */
export function debounce<T1,T2>(func: (this: T1, ...args: T2[]) => any, wait: number, immediate?: boolean): (this: T1, ...args: T2[]) => void {
  let timeout: number;
  return function (this: T1) {
    let context = this, args = arguments;
    let later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    let callNow = immediate && !timeout;
    window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}
