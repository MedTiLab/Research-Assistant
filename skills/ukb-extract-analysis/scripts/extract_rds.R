# Extract explicitly indexed RDS slices with identical, unique participant sets.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 1L)
if (!requireNamespace("jsonlite", quietly = TRUE)) stop("jsonlite is required")
job <- jsonlite::fromJSON(args[[1]], simplifyVector = FALSE)
requested <- unlist(job$columns, use.names = FALSE)
result <- NULL
for (group in job$groups) {
  columns <- unlist(group$columns, use.names = FALSE)
  data <- readRDS(group$path)
  if (!is.data.frame(data)) stop("slice must be a data.frame")
  if (!all(c("eid", columns) %in% names(data))) stop("missing requested columns")
  if (anyNA(data$eid) || anyDuplicated(data$eid) || any(!nzchar(trimws(as.character(data$eid))))) stop("eid must be non-null, non-blank and unique")
  data <- as.data.frame(data)[, c("eid", columns), drop = FALSE]
  if (is.null(result)) {
    result <- data[order(data$eid), , drop = FALSE]
  } else {
    if (nrow(data) != nrow(result) || !setequal(data$eid, result$eid)) stop("participant sets differ")
    idx <- match(result$eid, data$eid)
    for (column in columns) {
      if (column %in% names(result)) stop("duplicate column across slices")
      result[[column]] <- data[[column]][idx]
    }
  }
  rm(data)
}
if (is.null(result) || !all(requested %in% names(result))) stop("incomplete extraction")
source_n <- nrow(result)
result <- result[, requested, drop = FALSE]
if (job$limit > 0) result <- head(result, job$limit)
saveRDS(result, job$out)
cat(jsonlite::toJSON(list(rowCount = nrow(result), sourceRowCount = source_n), auto_unbox = TRUE))
