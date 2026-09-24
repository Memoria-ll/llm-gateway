import { useNavigate } from '@solidjs/router';
import { Show, createSignal, onMount, type ParentComponent } from 'solid-js';
import { checkIsEmbeddedMode } from '../services/setup-status.js';

const EmbeddedModeGuard: ParentComponent = (props) => {
  const navigate = useNavigate();
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    if (await checkIsEmbeddedMode()) {
      navigate('/providers/usage-based', { replace: true });
      return;
    }
    setReady(true);
  });

  return <Show when={ready()}>{props.children}</Show>;
};

export default EmbeddedModeGuard;
