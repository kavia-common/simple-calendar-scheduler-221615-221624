import { useEffect } from 'react';

export function useTizenKeys(handlers) {
  useEffect(() => {
    function handleKeyDown(e) {
      switch (e.keyCode) {
        case 37: // LEFT
          handlers?.onLeft?.();
          e.preventDefault();
          break;
        case 38: // UP
          handlers?.onUp?.();
          e.preventDefault();
          break;
        case 39: // RIGHT
          handlers?.onRight?.();
          e.preventDefault();
          break;
        case 40: // DOWN
          handlers?.onDown?.();
          e.preventDefault();
          break;
        case 13: // ENTER
          handlers?.onEnter?.();
          e.preventDefault();
          break;
        case 10009: // BACK
          handlers?.onBack?.();
          e.preventDefault();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
