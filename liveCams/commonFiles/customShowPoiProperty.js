// License: (MPL v2)
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

function customShowPoiProperty(target){
	// デフォルトパネルにリンクや画像貼り付け機能を付加した 
	//console.log ( "Target:" , target , "  parent:", target.parentNode );
	//console.log("customShowPoiProperty:",pxy, svgMap.getCORSURL);

//	var metaSchema = target.parentNode.getAttribute("property").split(",");
	var metaSchema = null;
	if ( target.ownerDocument.firstChild.getAttribute("property") ){
		metaSchema = target.ownerDocument.firstChild.getAttribute("property").split(","); // debug 2013.8.27
	}


	var message="<table border='1' style='font-size:11px;word-break: break-all;table-layout:fixed;width:100%;border:solid orange;border-collapse: collapse'>";
	
	var titleAndLayerName ="";
	if ( target.getAttribute("data-title")){
		titleAndLayerName = target.getAttribute("data-title") + "/" + target.getAttribute("data-layername") + "\n";
	}
	
	if ( target.getAttribute("content") ){ // contentメタデータがある場合
		
		var metaData = svgMap.parseEscapedCsvLine(target.getAttribute("content"));
		
		message += "<tr><th style='width:25%'>name</th><th>value</th></tr>";
		if ( titleAndLayerName != ""){
			message += "<tr><td>title/Layer</td><td> " + titleAndLayerName + "</td></tr>";
		}
		
		if ( metaSchema && metaSchema.length == metaData.length ){
			for ( var i = 0 ; i < metaSchema.length ; i++ ){
				var data = "--";
				var asImage = false;
				if ( metaSchema[i].toLowerCase().indexOf("img")>=0 || metaSchema[i].toLowerCase().indexOf("image")>=0 || metaSchema[i].toLowerCase().indexOf("bitimage")>=0 ||  metaSchema[i].indexOf("画像")>=0){
					asImage = true;
				}
				if ( metaData[i]!=""){
					data = metaData[i];
					message += "<tr><td>"+metaSchema[i] + " </td><td> " + getHTMLval(data,asImage) + "</td></tr>";
				}
			}
		} else {
			for ( var i = 0 ; i < metaData.length ; i++ ){
				var data = "--";
				if ( metaData[i]!=""){
					data = metaData[i];
					message += "<tr><td>"+ i + " </td><td> " + getHTMLval(data) + "</td></tr>";
				}
			}
		}

	} else { // 無い場合
		var nm = target.attributes;
		for ( var i = 0 ; i < nm.length ; i++ ){
			message += "<tr><td>" + nm.item(i).nodeName + " </td><td> " + target.getAttribute(nm.item(i).nodeName) + "</td></tr>";
		}
	}
	
	if ( svgMap.getHyperLink(target) ){
		message += "<tr><td>link</td> <td><a href='" + svgMap.getHyperLink(target).href + "' target=`_blank'>" +  svgMap.getHyperLink(target).href + "</a></td></tr>";
	}
	
	if ( target.getAttribute("lat") ){
		message += "<tr><td>latitude</td> <td>" + getFormattedRange(target.getAttribute("lat")) + "</td></tr>";
		message += "<tr><td>longitude</td> <td>" + getFormattedRange(target.getAttribute("lng")) + "</td></tr>";
	}
	
	message += "</table>";
	//console.log(message);
	svgMap.showModal(message,400,600);

}
function getFormattedRange( prop ){
	var rangeStr = prop.split(",");
	var ans = "";
	for ( var i = 0 ; i < rangeStr.length ; i++ ){
		ans += svgMap.numberFormat(Number(rangeStr[i]),6);
		if ( i < rangeStr.length - 1 ){
			ans += ",";
		}
	}
	return ( ans );
}

function getHTMLval( val , embedImage){
	var ans;
	if ( val.toLowerCase().indexOf(".png")>=0 || val.toLowerCase().indexOf(".jpg")>=0 || val.toLowerCase().indexOf(".jpeg")>=0 || val.toLowerCase().indexOf(".gif")>=0 || val.toLowerCase().indexOf(".svg")>=0 || embedImage ){
		var cors = "";
		var imgSrc = val;
		if ( val.indexOf("http:")==0 ){
			imgSrc = svgMap.getCORSURL(val);
			cors="crossorigin='anonymous'";
		}
		ans =`<a target="img" href="${val}"><img style="opacity:1" src="${imgSrc}" width="100%" ${cors}/></a>`;
	} else if ( val.indexOf("http://")==0 || val.indexOf("https://")==0 || val.toLowerCase().indexOf(".html")>=0 || val.indexOf(".htm")>=0){
		ans =`<a target="htmlContent" href="${val}" >${val}</a>`;
	} else {
		ans = val;
	}
	return ( ans );
}
