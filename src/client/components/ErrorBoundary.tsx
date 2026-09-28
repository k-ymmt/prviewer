import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Flash } from '@primer/react';

interface Props {
  children: ReactNode;
  /** Short description of what failed, shown to the user. */
  label: string;
}

interface State {
  error: Error | null;
}

/** Keeps a rendering failure in one part of the page (e.g. a single diff) from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`prviewer: ${this.props.label} failed to render`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Flash variant="danger" className="error-boundary">
          {this.props.label} failed to render: {this.state.error.message}
        </Flash>
      );
    }
    return this.props.children;
  }
}
