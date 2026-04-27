/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'react-plotly.js' {
  import { ComponentType } from 'react';
  import type { Data, Layout, Config } from 'plotly.js';

  interface PlotProps {
    data?: Partial<Data>[];
    layout?: Partial<Layout>;
    config?: Partial<Config>;
    style?: React.CSSProperties;
    className?: string;
    useResizeHandler?: boolean;
    debug?: boolean;
    onInitialized?: (figure: any, graphDiv: any) => void;
    onUpdate?: (figure: any, graphDiv: any) => void;
    onClick?: (event: any) => void;
    onSelected?: (event: any) => void;
    onDoubleClick?: (event: any) => void;
    onHover?: (event: any) => void;
    onUnhover?: (event: any) => void;
    onRelayout?: (event: any) => void;
    onRestyle?: (event: any) => void;
    [key: string]: unknown;
  }

  const Plot: ComponentType<PlotProps>;
  export default Plot;
}
