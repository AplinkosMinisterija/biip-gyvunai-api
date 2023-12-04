import { get, isEmpty } from 'lodash';

export const handlePagination = ({
  data,
  page,
  pageSize,
}: {
  data: any[];
  page: number;
  pageSize: number;
}) => {
  const start = (page - 1) * pageSize;
  const end = page * pageSize;
  const totalPages = Math.ceil(data.length / pageSize);
  const rows = data.slice(start, end);

  return { totalPages, rows };
};

export const sortByField = ({ data, field }: { data: any[]; field: string }) => {
  if (isEmpty(data)) return [];

  const isDesc = field[0] === '-';
  const sortField = isDesc ? field.slice(1) : field;
  const isNumberValue = typeof get(data[0], sortField) === 'number';

  return data.sort((first, second) => {
    if (isDesc) {
      if (isNumberValue) {
        return get(second, sortField) - get(first, sortField);
      } else {
        return get(second, sortField).localeCompare(get(first, sortField));
      }
    } else {
      if (isNumberValue) {
        return get(first, sortField) - get(second, sortField);
      } else {
        return get(first, sortField).localeCompare(get(second, sortField));
      }
    }
  });
};

export const searchByFields = ({
  data,
  searchFields,
  search,
}: {
  data: any[];
  searchFields: string[];
  search: string;
}) => {
  if (isEmpty(data)) return [];

  return data.filter((item) => {
    return searchFields
      .filter((searchField) => !!get(item, searchField))
      .some((searchField) => {
        return get(item, searchField)
          .toString()
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase());
      });
  });
};

export const handleFormatResponse = ({
  data,
  all,
  page,
  pageSize,
  searchFields,
  search,
  sort,
}: {
  data: any[];
  page: number;
  search?: string;
  searchFields: string[];
  pageSize: number;
  sort?: string;
  all?: boolean;
}) => {
  if (searchFields && search) {
    data = searchByFields({
      data,
      search,
      searchFields,
    });
  }

  if (sort) {
    data = sortByField({
      data,
      field: sort,
    });
  }

  if (all) {
    return data;
  }

  const { rows, totalPages } = handlePagination({
    data,
    page,
    pageSize,
  });

  return {
    rows,
    total: data.length,
    pageSize,
    page,
    totalPages,
  };
};
