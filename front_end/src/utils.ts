/** debounce 
 * It gives back a function that may be called only once during the wiat period. Immediately or at the end of the period.
 * Each new call reset the timeout and so extend the wait period.
 * @param func the function to wrap
 * @param wait the timeout
 * @param immediate if true called the function is immediately executed otherwise it is executed at the end of the debounce.
 * 
 * Badly typed 
 */
export function debounce(func: (...args: any[]) => any, wait: number, immediate?: boolean): (...args: any[]) => void {
  let timeout;
  return function () {
    let context = this, args = arguments;
    let later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    let callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}
