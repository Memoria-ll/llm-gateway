import { useNavigate } from '@solidjs/router';
import { type Component, onMount } from 'solid-js';
import { checkIsEmbeddedMode } from '../services/setup-status.js';

const RootRedirect: Component = () => {
  const navigate = useNavigate();
  onMount(async () => {
    navigate((await checkIsEmbeddedMode()) ? '/providers/usage-based' : '/overview', {
      replace: true,
    });
  });
  return null;
};

export default RootRedirect;
