export interface RawChartData {
  timestamp: number;
  price: number;
}

export interface FormattedChartData {
  time: string;
  value: number;
}

export function formatChartData(data: RawChartData[]): FormattedChartData[] {
  return data.map((item) => {
    const date = new Date(item.timestamp);
    // Format to a simple 'MM/DD HH:mm' string for mock purposes
    const formattedTime = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    return {
      time: formattedTime,
      value: item.price,
    };
  });
}
