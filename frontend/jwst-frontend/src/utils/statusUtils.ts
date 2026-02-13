export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'processing':
      return 'orange';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
};
