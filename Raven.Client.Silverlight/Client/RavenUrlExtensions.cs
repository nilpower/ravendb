﻿namespace Raven.Client.Silverlight.Client
{
	using System;
	using System.Collections.Generic;
	using System.Net;
	using System.Net.Browser;
	using Raven.Client.Client;

	public static class RavenUrlExtensions
	{
		public static string Indexes(this string url, string index)
		{
			return url + "/indexes/" + index;
		}

		public static string Docs(this string url, string key)
		{
			return url + "/docs/" + key;
		}

		public static string Docs(this string url, int start, int pageSize)
		{
			return url + "/docs/?start=" + start + "&pageSize=" + pageSize;
		}

		public static string Queries(this string url)
		{
			return url + "/queries/";
		}

		public static Uri ToUri(this string url)
		{
			return new Uri(url);
		}

		public static HttpWebRequest ToRequest(this string url, IDictionary<string, string> operationsHeaders, ICredentials credentials, string verb)
		{
			var request = (HttpWebRequest)WebRequestCreator.ClientHttp.Create( url.ToUri() );
			request.WithOperationHeaders(operationsHeaders);
			request.Method = verb;
			return request;
		}

		public static HttpWebRequest ToRequest(this string url, IDictionary<string, string> operationsHeaders, ICredentials credentials)
		{
			return ToRequest(url, operationsHeaders, credentials, "GET");
		}

		public static HttpJsonRequest ToJsonRequest(this string url, object requestor, ICredentials credentials, Document.DocumentConvention convention)
		{
			return HttpJsonRequest.CreateHttpJsonRequest(requestor, url, "GET", credentials, convention);
		}

		static HttpWebRequest WithOperationHeaders(this HttpWebRequest request, IDictionary<string, string> operationsHeaders)
		{
			foreach (var header in operationsHeaders)
			{
				request.Headers[header.Key] = header.Value;
			}
			return request;
		}
	}
}