import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration } from 'chart.js';
import { registerFont } from 'canvas';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerDateAdapter } from './chart-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a singleton ChartJSNodeCanvas instance to reuse across chart generations
// This ensures the date adapter registration persists
let chartJSNodeCanvasInstance: ChartJSNodeCanvas | null = null;

function getChartJSNodeCanvas(): ChartJSNodeCanvas {
  if (!chartJSNodeCanvasInstance) {
    chartJSNodeCanvasInstance = new ChartJSNodeCanvas({
      width: 800,
      height: 500,
      backgroundColour: 'white',
      chartCallback: (ChartJS) => {
        // Register date adapter with the Chart.js instance used by ChartJSNodeCanvas
        // This is necessary because ChartJSNodeCanvas creates an isolated Chart.js context
        registerDateAdapter(ChartJS);
      }
    });
  }
  return chartJSNodeCanvasInstance;
}

// Register custom fonts
try {
  // Register Sora (regular weight)
  registerFont(join(__dirname, '../../fonts/sora-latin-400-normal.ttf'), {
    family: 'Sora',
    weight: 'normal'
  });

  // Register Sora (bold weight)
  registerFont(join(__dirname, '../../fonts/sora-latin-700-normal.ttf'), {
    family: 'Sora',
    weight: 'bold'
  });

  console.log('[Fonts] Custom fonts registered successfully');
} catch (error) {
  console.error('[Fonts] Failed to register custom fonts:', error);
}

export interface ChartData {
  timestamp: string;
  electric: number;
  water: number;
  ac: number;
}

export interface ChartResult {
  buffer: Buffer;
  title: string;
}

interface DatasetConfig {
  label: string;
  data: { x: number; y: number }[];
  borderColor: string;
  backgroundColor: string;
}

const DATASET_CONFIGS: DatasetConfig[] = [
  {
    label: '电费 (¥)',
    data: [],
    borderColor: 'rgb(255, 99, 132)',
    backgroundColor: 'rgba(255, 99, 132, 0.1)'
  },
  {
    label: '水费 (¥)',
    data: [],
    borderColor: 'rgb(54, 162, 235)',
    backgroundColor: 'rgba(54, 162, 235, 0.1)'
  },
  {
    label: '空调费 (¥)',
    data: [],
    borderColor: 'rgb(75, 192, 192)',
    backgroundColor: 'rgba(75, 192, 192, 0.1)'
  }
];

/**
 * Generate PNG chart images for billing data
 * Automatically splits positive and negative values into separate charts
 * Returns an array of chart buffers (1 or 2 charts)
 */
export const generateBillingCharts = async (
  data: ChartData[],
  room: string
): Promise<ChartResult[]> => {
  if (data.length < 2) {
    return [];
  }

  // Sort data by timestamp
  const sorted = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Convert data to {x, y} format with timestamps in milliseconds for proper time scaling
  const electricData = sorted.map((d) => ({ x: new Date(d.timestamp).getTime(), y: d.electric }));
  const waterData = sorted.map((d) => ({ x: new Date(d.timestamp).getTime(), y: d.water }));
  const acData = sorted.map((d) => ({ x: new Date(d.timestamp).getTime(), y: d.ac }));

  // Determine which items have any values <= -10
  const hasNegativeElectric = sorted.some((d) => d.electric <= -10);
  const hasNegativeWater = sorted.some((d) => d.water <= -10);
  const hasNegativeAc = sorted.some((d) => d.ac <= -10);

  // Separate datasets into positive and negative groups
  const positiveDatasets: DatasetConfig[] = [];
  const negativeDatasets: DatasetConfig[] = [];

  const allData = [
    { data: electricData, hasNegative: hasNegativeElectric, index: 0 },
    { data: waterData, hasNegative: hasNegativeWater, index: 1 },
    { data: acData, hasNegative: hasNegativeAc, index: 2 }
  ];

  for (const { data: itemData, hasNegative, index } of allData) {
    const isAllZero = itemData.every((point) => point.y === 0);
    if (isAllZero) {
      continue;
    }

    const config = { ...DATASET_CONFIGS[index], data: itemData };
    if (hasNegative) {
      negativeDatasets.push(config);
    } else {
      config.data = itemData.map((point) => ({ x: point.x, y: Math.max(point.y, 0) }));
      positiveDatasets.push(config);
    }
  }

  // Create chart results
  const results: ChartResult[] = [];
  const chartJSNodeCanvas = getChartJSNodeCanvas();

  try {
    if (positiveDatasets.length > 0) {
      const title = `${room} 余额账单`;
      const config = createChartConfig(positiveDatasets, title, sorted.length);
      const buffer = await chartJSNodeCanvas.renderToBuffer(config);
      results.push({ buffer, title });
    }

    if (negativeDatasets.length > 0) {
      const title = `${room} 欠费账单`;
      const config = createChartConfig(negativeDatasets, title, sorted.length);
      const buffer = await chartJSNodeCanvas.renderToBuffer(config);
      results.push({ buffer, title });
    }
  } catch (error) {
    console.error('Failed to generate charts:', error);
  }

  return results;
};

/**
 * Create a chart configuration with time scale
 */
const createChartConfig = (
  datasets: DatasetConfig[],
  title: string,
  totalPoints: number
): ChartConfiguration => {
  let hourInterval;
  if (totalPoints < 48) {
    hourInterval = 1;
  } else if (totalPoints < 72) {
    hourInterval = 2;
  } else if (totalPoints < 96) {
    hourInterval = 4;
  } else if (totalPoints < 144) {
    hourInterval = 6;
  } else {
    hourInterval = 8;
  }

  const lastDataset = datasets[datasets.length - 1];
  const lastHour = new Date(lastDataset.data[lastDataset.data.length - 1].x).getHours();

  return {
    type: 'line',
    data: {
      datasets: datasets.map((ds) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.borderColor,
        backgroundColor: ds.backgroundColor,
        borderWidth: 2.5,
        cubicInterpolationMode: 'monotone',
        fill: true,
        pointRadius: totalPoints < 24 ? 4 : 0
      }))
    },
    options: {
      devicePixelRatio: 2,
      responsive: true,
      font: {
        family: "'Sora', sans-serif"
      },
      plugins: {
        title: {
          display: true,
          text: title,
          font: {
            size: 18,
            weight: 'bold',
            family: "'Sora', sans-serif"
          }
        },
        legend: {
          display: true,
          position: 'top',
          labels: {
            font: {
              family: "'Sora', sans-serif"
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: '余额 (¥)',
            font: {
              family: "'Sora', sans-serif"
            }
          },
          ticks: {
            font: {
              family: "'Sora', sans-serif"
            }
          }
        },
        x: {
          type: 'time',
          title: {
            display: true,
            text: '时间',
            font: {
              family: "'Sora', sans-serif"
            }
          },
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: {
              family: "'Sora', sans-serif"
            },
            callback: function (value, index, ticks) {
              const date = new Date(value);

              const hour = date.getHours();
              const dateLabel = date.toLocaleDateString('zh-CN', {
                month: '2-digit',
                day: '2-digit'
              });
              const hourLabel = `${hour.toString().padStart(2, '0')}:00`;

              if (index === ticks.length - 1) {
                return hour === 0 ? dateLabel : hourLabel;
              }

              if (index >= ticks.length - hourInterval) {
                const hourDiff = Math.abs(lastHour - hour);
                if (hourDiff < hourInterval / 2) {
                  return null;
                }
              }

              if (hour === 0) {
                return dateLabel;
              }

              if (hour % hourInterval === 0) {
                return hourLabel;
              }

              return null;
            },
            autoSkip: false // Disable auto-skipping to use custom callback
          }
        }
      }
    },
    plugins: [
      {
        id: 'customCanvasBackgroundColor',
        beforeDraw: (chart) => {
          const { ctx } = chart;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      }
    ]
  };
};

/**
 * Generate billing summary with current values and 24h changes
 */
export const generateBillingSummary = (
  current: { electric: number; water: number; ac: number },
  change24h?: { electric: number; water: number; ac: number } | null
): string => {
  let output = '📊 当前余额\n';
  output += '─'.repeat(15) + '\n';
  output += `⚡ 电费：\t${current.electric.toFixed(2)} 元\n`;
  output += `💧 水费：\t${current.water.toFixed(2)} 元\n`;
  output += `❄️ 空调费：\t${current.ac.toFixed(2)} 元\n`;

  if (change24h) {
    output += '\n📈 最近 24 小时\n';
    output += '─'.repeat(15) + '\n';
    output += `⚡ 电费：\t${change24h.electric > 0 ? '+' : ''}${change24h.electric.toFixed(2)} 元\n`;
    output += `💧 水费：\t${change24h.water > 0 ? '+' : ''}${change24h.water.toFixed(2)} 元\n`;
    output += `❄️ 空调费：\t${change24h.ac > 0 ? '+' : ''}${change24h.ac.toFixed(2)} 元\n\n`;
  }

  return output;
};
